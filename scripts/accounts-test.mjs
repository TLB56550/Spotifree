// Test de la mise à niveau vers les comptes : node scripts/accounts-test.mjs <dossier-de-test-audio>
// Part d'une base « d'avant les comptes » (version 2) et vérifie que les playlists, likes et écoutes
// passent au premier administrateur, créé ici depuis l'environnement (cas du NAS / Docker).
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const libDir = process.argv[2];
if (!libDir) throw new Error('Indique le dossier de musique de test.');
const PORT = 4397;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-accounts-'));
const src = fs.readFileSync('server/src/db.ts', 'utf8');
const schema = (n) => new RegExp(`const SCHEMA_V${n} = \`([\\s\\S]*?)\`;`).exec(src)[1];

const findAudio = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) {
      const r = findAudio(f);
      if (r) return r;
    } else if (f.endsWith('.mp3')) return f;
  }
};
fs.mkdirSync(path.join(dataDir, 'Importations'));
const file = path.join(dataDir, 'Importations', 'ancien.mp3');
fs.copyFileSync(findAudio(libDir), file);

// Base de l'ancienne version
const db = new DatabaseSync(path.join(dataDir, 'library.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(schema(1));
db.exec(schema(2));
db.exec('PRAGMA user_version = 2');
db.exec(`
  INSERT INTO artists (id, name, key, search) VALUES (1, 'Vieux', 'vieux', 'vieux');
  INSERT INTO albums (id, title, artist_id, key, search, added_at) VALUES (1, 'Souvenirs', 1, 'vieux|souvenirs', 'souvenirs vieux', 1);
  INSERT INTO tracks (id, path, mtime, size, title, artist, album_id, artist_id, search, added_at, play_count, last_played)
    VALUES (1, '${file.replaceAll("'", "''")}', 0, 0, 'Ancien titre', 'Vieux', 1, 1, 'ancien titre vieux', 1, 3, 1700000000000);
  INSERT INTO playlists (id, name, description, created_at, updated_at) VALUES (1, 'Ancienne playlist', '', 1, 1);
  INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (1, 1, 0, 1);
  INSERT INTO favorites (track_id, added_at) VALUES (1, 1);
  INSERT INTO plays (track_id, played_at) VALUES (1, 1700000000000);
  INSERT INTO devices (name, token_hash, created_at, last_seen) VALUES ('Vieux téléphone', 'abc', 1, 1);
`);
db.close();

const server = spawn('node', ['--no-warnings', 'server/dist/server.mjs'], {
  env: {
    ...process.env,
    UPDATE_DISABLED: '1',
    DATA_DIR: dataDir,
    PORT: String(PORT),
    MB_ADMIN_EMAIL: 'Chef@Example.com',
    MB_ADMIN_NAME: 'Le chef',
    MB_ADMIN_PASSWORD: 'motdepasse-du-chef',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, body, cookie) {
  const res = await fetch(base + url, {
    method,
    headers: { 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}
const cookieOf = (r) => /mb_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')?.[0];
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await call('GET', '/api/health')).status === 200) break;
    } catch {
      await sleep(100);
    }
  }
  console.log('Mise à niveau vers les comptes');
  let r = await call('GET', '/api/auth/state');
  assert.equal(r.json.hasUsers, true, 'administrateur créé depuis l\'environnement');
  assert.equal(r.json.canSetup, false);
  assert.equal((await call('POST', '/api/auth/register', { email: 'x@example.com', password: 'motdepasse1' })).json.user.isAdmin, false);
  ok('Administrateur créé au démarrage depuis MB_ADMIN_EMAIL / MB_ADMIN_PASSWORD ; les suivants sont des invités');

  r = await call('POST', '/api/auth/login', { email: 'chef@example.com', password: 'motdepasse-du-chef' });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.isAdmin, true);
  assert.equal(r.json.user.name, 'Le chef');
  const chef = cookieOf(r);

  await sleep(1500); // l'analyse met le titre à jour sans changer son identifiant
  assert.deepEqual((await call('GET', '/api/playlists', undefined, chef)).json.map((p) => p.name), ['Ancienne playlist']);
  assert.deepEqual((await call('GET', '/api/favorites/ids', undefined, chef)).json, [1]);
  const home = (await call('GET', '/api/home', undefined, chef)).json;
  assert.equal(home.favoriteCount, 1);
  assert.equal(home.mostPlayed[0]?.id, 1);
  assert.equal(home.mostPlayed[0]?.playCount, 3);
  assert.equal(home.recentAlbums.length, 1);
  ok('Playlists, likes et écoutes d\'avant les comptes repris par l\'administrateur');

  r = await call('POST', '/api/auth/register', { email: 'invite@example.com', password: 'motdepasse1' });
  const guest = cookieOf(r);
  assert.deepEqual((await call('GET', '/api/playlists', undefined, guest)).json, []);
  assert.deepEqual((await call('GET', '/api/favorites/ids', undefined, guest)).json, []);
  assert.equal((await call('GET', '/api/home', undefined, guest)).json.mostPlayed.length, 0);
  assert.equal((await call('GET', '/api/tracks', undefined, guest)).json.length >= 1, true, 'la musique, elle, est commune');
  ok('Un invité voit la même musique mais aucune donnée personnelle de l\'administrateur');

  // Secours : l'administrateur a oublié son mot de passe (outil en ligne de commande sur le serveur)
  const reset = (mail) =>
    spawnSync('node', ['--no-warnings', 'server/dist/server.mjs', 'reset-password', mail], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });
  let out = reset('inconnu@example.com');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /Aucun compte/);
  assert.equal(reset('pas-un-mail').status, 2);
  out = reset('CHEF@example.com');
  assert.equal(out.status, 0, out.stderr);
  const temp = /: (\S+)\s*$/m.exec(out.stdout.split('\n').find((l) => l.includes('Mot de passe provisoire')))[1];
  assert.equal((await call('GET', '/api/tracks', undefined, chef)).status, 401, 'ses appareils sont déconnectés');
  assert.equal((await call('POST', '/api/auth/login', { email: 'chef@example.com', password: 'motdepasse-du-chef' })).status, 401);
  r = await call('POST', '/api/auth/login', { email: 'chef@example.com', password: temp });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.mustChange, true);
  ok('Mot de passe oublié : l\'outil du serveur crée un mot de passe provisoire (changement exigé à la connexion)');

  console.log(`\n${passed} vérifications réussies.`);
} catch (e) {
  console.error('\nÉCHEC :', e);
  console.error('--- journal du serveur ---\n' + logs);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
