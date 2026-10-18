// Test de la mise à jour automatique : node scripts/update-test.mjs  (après « npm run build »)
// Un faux GitHub publie des versions ; un vrai serveur, installé comme sur Windows (dossiers app + runtime), les cherche.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-upd-'));
const PORT = 4420;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (m) => console.log(`  ✓ ${m}${++passed ? '' : ''}`);

// Paquet « 9.9.9 » : un faux server.mjs (il doit citer sa version) et une interface minimale.
const pkg = path.join(tmp, 'pkg');
fs.mkdirSync(path.join(pkg, 'app', 'public'), { recursive: true });
fs.writeFileSync(path.join(pkg, 'app', 'server.mjs'), '// nouvelle version "9.9.9"\n');
fs.writeFileSync(path.join(pkg, 'app', 'public', 'index.html'), '<title>nouvelle interface</title>');
const bundle = path.join(tmp, 'Ma-Bibliotheque-app.tar.gz');
execFileSync('tar', ['-czf', bundle, '-C', pkg, 'app']);
const good = fs.readFileSync(bundle);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let mode = 'good';
let apiCalls = 0;
const fake = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${fake.address().port}`;
  if (req.url === '/releases') {
    apiCalls++;
    const asset = (digest) => ({ name: 'Ma-Bibliotheque-app.tar.gz', size: good.length, browser_download_url: `${base}/bundle`, digest });
    const releases = {
      good: [
        { tag_name: 'apk-12', assets: [] },
        { tag_name: 'pc-9.9.9', assets: [asset('sha256:' + sha(good))] },
        { tag_name: 'pc-9.9.10-test', assets: [] },
      ],
      tampered: [{ tag_name: 'pc-9.9.9', assets: [asset('sha256:' + '0'.repeat(64))] }],
      nodigest: [{ tag_name: 'pc-9.9.9', assets: [asset(null)] }],
      same: [{ tag_name: 'pc-0.0.1', assets: [asset('sha256:' + sha(good))] }],
      down: null,
    }[mode];
    if (!releases) return res.writeHead(503).end();
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(releases));
  }
  if (req.url === '/feed') {
    const entries = ['pc-9.9.9', 'apk-12', 'pc-9.9.10-test', 'pc-0.0.1'];
    return res.writeHead(200, { 'content-type': 'application/atom+xml' }).end(
      `<feed>${entries.map((t) => `<entry><link rel="alternate" href="https://github.com/x/y/releases/tag/${t}"/><title>${t}</title></entry>`).join('')}</feed>`,
    );
  }
  if (req.url === '/dl/pc-9.9.9/Ma-Bibliotheque-app.tar.gz') return res.writeHead(200, { 'content-length': good.length }).end(good);
  if (req.url === '/dl/pc-9.9.9/Ma-Bibliotheque-app.tar.gz.sha256') return res.end(`${sha(good)}  Ma-Bibliotheque-app.tar.gz\n`);
  if (req.url === '/bundle') return res.writeHead(200, { 'content-length': good.length }).end(good);
  res.writeHead(404).end();
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/** Installe l'application comme sur Windows : <dossier>/app/server.mjs + <dossier>/runtime. */
function install(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app', 'public', 'assets'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server', 'dist', 'server.mjs'), path.join(dir, 'app', 'server.mjs'));
  fs.cpSync(path.join(root, 'web', 'dist'), path.join(dir, 'app', 'public'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'public', 'assets', 'ancien-fichier.js'), '1');
  return dir;
}
let cookie = null;
// Les routes de mise à jour demandent un compte : le serveur de test crée un administrateur au démarrage.
async function session() {
  if (cookie) return cookie;
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'x-mb': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'motdepasse-test' }),
  });
  const set = /mb_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '');
  if (!set) throw new Error('connexion impossible : ' + r.status);
  return (cookie = set[0]);
}
function start(dir, extraEnv = {}) {
  cookie = null;
  const dataDir = path.join(tmp, 'data-' + path.basename(dir));
  const child = spawn('node', ['--no-warnings', path.join(dir, 'app', 'server.mjs')], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), MB_ADMIN_EMAIL: 'admin@example.com', MB_ADMIN_PASSWORD: 'motdepasse-test', UPDATE_API_URL: `http://127.0.0.1:${fake.address().port}/releases`, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { logs: '', code: undefined };
  child.stdout.on('data', (d) => (out.logs += d));
  child.stderr.on('data', (d) => (out.logs += d));
  child.on('exit', (c) => (out.code = c));
  out.child = child;
  return out;
}
const status = async () => (await fetch(`http://127.0.0.1:${PORT}/api/update`, { headers: { cookie: await session() } })).json();
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error('délai dépassé');
    await sleep(100);
  }
}

try {
  console.log('Mise à jour automatique');

  // 1. Une version plus récente est publiée : téléchargement, installation, redémarrage demandé (code 75)
  let dir = install('ok');
  let s = start(dir);
  const seen = new Set();
  await until(async () => {
    try {
      seen.add((await status()).state);
    } catch {}
    return s.code !== undefined;
  }, 30000);
  assert.equal(s.code, 75, s.logs);
  assert.ok(seen.has('restarting') || seen.has('installing') || seen.has('downloading'), [...seen].join());
  assert.match(fs.readFileSync(path.join(dir, 'app', 'server.mjs'), 'utf8'), /9\.9\.9/);
  assert.equal(fs.readFileSync(path.join(dir, 'app', 'public', 'index.html'), 'utf8'), '<title>nouvelle interface</title>');
  assert.ok(!fs.existsSync(path.join(dir, 'app', 'public', 'assets', 'ancien-fichier.js')), "l'ancienne interface est remplacée");
  assert.ok(fs.existsSync(path.join(tmp, 'data-ok', 'update', 'backup', 'server.mjs')), 'sauvegarde de la version précédente');
  ok('Version plus récente : téléchargée, vérifiée, installée, redémarrage demandé (code 75)');

  // 1b. Même chose par le flux Atom des publications (sans l'API GitHub, limitée en nombre d'appels)
  mode = 'down'; // l'API est volontairement en panne : seul le flux doit servir
  dir = install('feed');
  const fp = fake.address().port;
  s = start(dir, { UPDATE_FEED_URL: `http://127.0.0.1:${fp}/feed`, UPDATE_DOWNLOAD_BASE: `http://127.0.0.1:${fp}/dl` });
  await until(() => s.code !== undefined, 30000);
  assert.equal(s.code, 75, s.logs);
  assert.match(fs.readFileSync(path.join(dir, 'app', 'server.mjs'), 'utf8'), /9\.9\.9/);
  ok('Flux Atom des publications : version trouvée, paquet et empreinte récupérés, installée');
  mode = 'good';

  // 2. Fichier altéré : rien n'est installé, l'application continue
  mode = 'tampered';
  dir = install('tampered');
  const before = fs.readFileSync(path.join(dir, 'app', 'server.mjs'));
  s = start(dir);
  let st = await until(async () => {
    const x = await status();
    return x.state === 'error' ? x : null;
  });
  assert.match(st.error, /altéré/);
  assert.ok(fs.readFileSync(path.join(dir, 'app', 'server.mjs')).equals(before));
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status, 200);
  assert.equal(s.code, undefined);
  ok('Empreinte différente : refusé, ancienne version conservée, application toujours en marche');
  s.child.kill();
  await until(() => s.code !== undefined);

  // 3. Publication sans empreinte : ignorée
  mode = 'nodigest';
  s = start(install('nodigest'));
  st = await until(async () => {
    const x = await status();
    return x.checkedAt ? x : null;
  });
  assert.equal(st.state, 'idle');
  assert.equal(st.latest, st.current);
  ok('Publication sans empreinte : ignorée');
  s.child.kill();
  await until(() => s.code !== undefined);

  // 4. Déjà à jour
  mode = 'same';
  s = start(install('same'));
  st = await until(async () => {
    const x = await status();
    return x.checkedAt ? x : null;
  });
  assert.equal(st.state, 'idle');
  assert.equal(s.code, undefined);
  ok('Déjà à jour : rien à faire');

  // 5. Recherche manuelle depuis le PC ; refusée depuis un autre appareil n'est pas testable ici (voir smoke-test)
  const callsBefore = apiCalls;
  const r = await fetch(`http://127.0.0.1:${PORT}/api/update/check`, { method: 'POST', headers: { 'x-mb': '1', cookie: await session() } });
  assert.equal(r.status, 200);
  await until(() => apiCalls > callsBefore);
  ok('Recherche manuelle : relance la vérification');
  s.child.kill();
  await until(() => s.code !== undefined);

  // 6. GitHub injoignable : l'application démarre quand même
  mode = 'down';
  s = start(install('down'));
  st = await until(async () => {
    const x = await status();
    return x.state === 'error' ? x : null;
  });
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status, 200);
  ok('GitHub injoignable : erreur signalée, application utilisable');
  s.child.kill();
  await until(() => s.code !== undefined);

  // 7. Lancée depuis les sources (pas de dossier « runtime ») : signale sans installer
  mode = 'good';
  const dev = install('dev');
  fs.rmSync(path.join(dev, 'runtime'), { recursive: true });
  s = start(dev);
  st = await until(async () => {
    const x = await status();
    return x.checkedAt ? x : null;
  });
  assert.equal(st.canInstall, false);
  assert.equal(st.latest, '9.9.9');
  assert.equal(s.code, undefined);
  ok('Hors installation : version disponible signalée, rien n\'est modifié');
  s.child.kill();
  await until(() => s.code !== undefined);

  console.log(`\n${passed} vérifications réussies.`);
} catch (e) {
  console.error('\nÉCHEC :', e);
  process.exitCode = 1;
} finally {
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
