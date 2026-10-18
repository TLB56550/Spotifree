// Test des deux applications Windows : node scripts/player-test.mjs  (après « npm run build »)
// Le lecteur (« server.mjs player ») et l'application Serveur (« server.mjs console ») démarrent le serveur en arrière-plan,
// qui survit à tout, sauf à « Arrêter le serveur » (depuis l'application Serveur).
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-player-'));
const PORT = 4450;
const base = `http://127.0.0.1:${PORT}`;
const cbase = `http://127.0.0.1:${PORT + 2}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (m) => console.log(`  ✓ ${m}${++passed ? '' : ''}`);

function install(name, { launchers = false } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server', 'dist', 'server.mjs'), path.join(dir, 'app', 'server.mjs'));
  fs.cpSync(path.join(root, 'web', 'dist'), path.join(dir, 'app', 'public'), { recursive: true });
  if (launchers) {
    fs.mkdirSync(path.join(dir, 'app', 'launchers'));
    fs.writeFileSync(path.join(dir, 'app', 'launchers', 'Ma Bibliotheque.vbs'), "' lanceur\r\n");
    fs.writeFileSync(path.join(dir, 'app', 'launchers', 'Ma Bibliotheque Serveur.vbs'), "' lanceur serveur\r\n");
  }
  return dir;
}
const env = (dir, extra = {}) => ({
  ...process.env,
  DATA_DIR: path.join(tmp, 'data-' + path.basename(dir)),
  PORT: String(PORT),
  UPDATE_DISABLED: '1',
  MB_PLAYER_DRY: '1',
  MB_STARTUP_DIR: path.join(tmp, 'startup-' + path.basename(dir)),
  ...extra,
});
const app = (mode) => (dir, args = [], extra = {}) =>
  spawnSync('node', ['--no-warnings', path.join(dir, 'app', 'server.mjs'), mode, ...args], { env: env(dir, extra), encoding: 'utf8', timeout: 60000 });
const player = app('player');
const consoleApp = app('console');
const health = async () => {
  try {
    return await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).json();
  } catch {
    return null;
  }
};
// Jeton local écrit par le serveur : c'est lui qui permet de fermer le serveur sans compte (comme l'installateur).
const localToken = () => {
  const files = fs
    .readdirSync(tmp)
    .map((d) => path.join(tmp, d, 'server.token'))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files.length ? fs.readFileSync(files[0], 'utf8').trim() : '';
};
// Appels à l'application Serveur (console) : pas de compte, c'est le PC qui fait foi.
const call = async (method, url, body) =>
  fetch(cbase + url.replace('/api/', '/api/console/'), {
    method,
    headers: { 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('délai dépassé');
    await sleep(150);
  }
}
const pids = (pattern) => {
  const r = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean).map(Number);
};

let dir;
try {
  console.log('Serveur et lecteur séparés');

  // 1. Le lecteur démarre le serveur en arrière-plan puis ouvre la fenêtre
  dir = install('a');
  assert.equal(await health(), null);
  let r = player(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`OPEN ${base}`));
  assert.equal((await health())?.app, 'ma-bibliotheque');
  assert.ok(fs.existsSync(path.join(tmp, 'data-a', 'server.log')), 'journal du serveur');
  ok('Lecteur : démarre le serveur en arrière-plan (sans fenêtre), ouvre la fenêtre, puis se termine');

  // 2. Le lecteur se rouvre : pas de second serveur
  const before = pids(path.join(dir, 'app', 'server.mjs') + ' serve');
  r = player(dir);
  assert.match(r.stdout, /OPEN/);
  assert.deepEqual(pids(path.join(dir, 'app', 'server.mjs') + ' serve'), before);
  assert.equal(before.length, 1);
  ok('Lecteur rouvert : le serveur déjà en marche est réutilisé');

  // 2b. L'application Serveur : même serveur, autre fenêtre (port de la console)
  r = consoleApp(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`OPEN ${cbase}$`, 'm'));
  assert.doesNotMatch(r.stdout, new RegExp(`OPEN ${base}`), 'l\'application Serveur n\'ouvre pas le lecteur');
  assert.deepEqual(pids(path.join(dir, 'app', 'server.mjs') + ' serve'), before, 'le serveur déjà en marche est réutilisé');
  assert.equal((await fetch(`${cbase}/api/health`)).status, 200);
  const consolePage = await (await fetch(cbase + '/')).text();
  const playerPage = await (await fetch(base + '/')).text();
  assert.match(consolePage, /Serveur/);
  assert.notEqual(consolePage, playerPage, 'deux pages différentes');
  ok('Application Serveur : ouvre la console de ce PC (pas le lecteur), réutilise le serveur en marche');

  // 3. Le serveur survit à un plantage (relancé par le superviseur)
  process.kill(before[0], 'SIGKILL');
  await until(async () => (await health())?.app === 'ma-bibliotheque' && pids(path.join(dir, 'app', 'server.mjs') + ' serve')[0] !== before[0]);
  ok('Plantage du serveur : relancé automatiquement');

  // 4. Démarrage avec Windows : activer / couper
  let st = (await call('GET', '/api/autostart')).json;
  assert.deepEqual(st, { available: true, enabled: false });
  st = (await call('PUT', '/api/autostart', { enabled: true })).json;
  assert.equal(st.enabled, true);
  const vbs = fs.readFileSync(path.join(tmp, 'startup-a', 'Ma Bibliotheque (serveur).vbs'));
  assert.deepEqual([...vbs.subarray(0, 2)], [0xff, 0xfe], 'UTF-16 avec BOM');
  const text = vbs.subarray(2).toString('utf16le');
  assert.ok(text.includes(path.join(dir, 'runtime', 'node.exe')) && text.includes(' run"'), text);
  st = (await call('PUT', '/api/autostart', { enabled: false })).json;
  assert.equal(st.enabled, false);
  assert.ok(!fs.existsSync(path.join(tmp, 'startup-a', 'Ma Bibliotheque (serveur).vbs')));
  ok('Démarrage avec Windows : activé (script en arrière-plan) puis coupé');

  // 5. « Arrêter le serveur » l'arrête vraiment (et le superviseur ne le relance pas)
  assert.equal((await call('POST', '/api/shutdown')).status, 200);
  await until(async () => (await health()) === null);
  await sleep(3500);
  assert.equal(await health(), null, 'pas de relance après un arrêt demandé');
  assert.deepEqual(pids(path.join(dir, 'app', 'server.mjs') + ' run'), []);
  ok('Arrêter le serveur (application Serveur) : arrêt complet, aucun processus restant');

  // 5b. Sans serveur, l'application Serveur le démarre elle-même
  r = consoleApp(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`OPEN ${cbase}$`, 'm'));
  assert.equal((await health())?.app, 'ma-bibliotheque');
  assert.equal((await call('GET', '/api/info')).status, 200);
  assert.equal((await call('POST', '/api/shutdown')).status, 200);
  await until(async () => (await health()) === null);
  ok('Application Serveur lancée sans serveur : il est démarré en arrière-plan');

  // 6. Le lecteur sait pointer vers un autre serveur (NAS)
  r = player(dir, ['--set-server', 'http://192.168.1.20:4242/']);
  assert.equal(r.status, 0);
  r = player(dir, ['--set-server', 'pas une adresse']);
  assert.equal(r.status, 1);
  r = player(dir);
  assert.match(r.stdout, /OPEN http:\/\/192\.168\.1\.20:4242$/m);
  assert.equal(await health(), null, 'aucun serveur local démarré quand le lecteur vise un NAS');
  fs.rmSync(path.join(tmp, 'data-a', 'player.json'));
  ok('Serveur distant : le lecteur ouvre l\'adresse choisie sans démarrer de serveur local');

  // 7. Lanceurs livrés avec une mise à jour : copiés à la racine de l'installation
  dir = install('b', { launchers: true });
  r = player(dir);
  await until(async () => fs.existsSync(path.join(dir, 'Ma Bibliotheque.vbs')));
  await until(async () => fs.existsSync(path.join(dir, 'Ma Bibliotheque Serveur.vbs')));
  assert.equal(fs.readFileSync(path.join(dir, 'Ma Bibliotheque.vbs'), 'utf8'), "' lanceur\r\n");
  assert.equal(fs.readFileSync(path.join(dir, 'Ma Bibliotheque Serveur.vbs'), 'utf8'), "' lanceur serveur\r\n");
  await call('POST', '/api/shutdown');
  await until(async () => (await health()) === null);
  ok('Lanceurs de la mise à jour (lecteur et serveur) : copiés dans le dossier d\'installation');

  // 8. Mise à jour automatique sous superviseur : redémarrage sur la nouvelle version, sans fenêtre
  const pkg = path.join(tmp, 'pkg', 'app');
  fs.mkdirSync(pkg, { recursive: true });
  execFileSync(
    path.join(root, 'node_modules', '.bin', 'esbuild'),
    ['server/src/main.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22', `--outfile=${pkg}/server.mjs`, '--define:__APP_VERSION__="9.9.9"', '--legal-comments=none', '--log-level=error',
     "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"],
    { cwd: root },
  );
  fs.cpSync(path.join(root, 'web', 'dist'), path.join(pkg, 'public'), { recursive: true });
  const bundle = path.join(tmp, 'Ma-Bibliotheque-app.tar.gz');
  execFileSync('tar', ['-czf', bundle, '-C', path.join(tmp, 'pkg'), 'app']);
  const good = fs.readFileSync(bundle);
  const fake = http.createServer((req, res) => {
    const b = `http://127.0.0.1:${fake.address().port}`;
    if (req.url === '/releases')
      return res.end(JSON.stringify([{ tag_name: 'pc-9.9.9', assets: [{ name: 'Ma-Bibliotheque-app.tar.gz', size: good.length, browser_download_url: b + '/bundle', digest: 'sha256:' + crypto.createHash('sha256').update(good).digest('hex') }] }]));
    res.writeHead(200, { 'content-length': good.length }).end(good);
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  dir = install('c');
  r = player(dir, [], { UPDATE_DISABLED: '0', UPDATE_API_URL: `http://127.0.0.1:${fake.address().port}/releases` });
  assert.equal(r.status, 0, r.stderr);
  await until(async () => (await health())?.version === '9.9.9', 40000);
  await call('POST', '/api/shutdown');
  await until(async () => (await health()) === null);
  fake.close();
  ok('Mise à jour automatique : le superviseur relance le serveur sur la nouvelle version');

  console.log(`\n${passed} vérifications réussies.`);
} catch (e) {
  console.error('\nÉCHEC :', e);
  for (const n of ['a', 'b', 'c']) {
    const f = path.join(tmp, 'data-' + n, 'server.log');
    if (fs.existsSync(f)) console.error(`--- journal ${n} ---\n` + fs.readFileSync(f, 'utf8').slice(-1500));
  }
  process.exitCode = 1;
} finally {
  for (const p of pids(tmp)) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {}
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
