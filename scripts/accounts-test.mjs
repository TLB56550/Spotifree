// Test de la mise à niveau vers les comptes : node scripts/accounts-test.mjs <dossier-de-test-audio>
// Part d'une base « d'avant les comptes » (version 2) et vérifie que les playlists, likes et écoutes
// passent au premier compte créé depuis le PC, ou à celui que l'application Serveur désigne.
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const libDir = process.argv[2];
if (!libDir) throw new Error('Indique le dossier de musique de test.');
let PORT = 4397;
let base = `http://127.0.0.1:${PORT}`;
let dataDir = '';
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

const sampleAudio = findAudio(libDir);
const dirs = [];
let server;
let logs = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Prépare un dossier de données « d'avant les comptes » et démarre le serveur dessus. */
async function start(port) {
  PORT = port;
  base = `http://127.0.0.1:${PORT}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-accounts-'));
  dirs.push(dataDir);
  fs.mkdirSync(path.join(dataDir, 'Importations'));
  const file = path.join(dataDir, 'Importations', 'ancien.mp3');
  fs.copyFileSync(sampleAudio, file);
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

  server = spawn('node', ['--no-warnings', 'server/dist/server.mjs'], {
    env: { ...process.env, UPDATE_DISABLED: '1', DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (logs += d));
  server.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await call('GET', '/api/health')).status === 200) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Le serveur ne démarre pas.');
}
async function stop() {
  server.kill();
  await new Promise((r) => server.once('exit', r));
}

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
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const ccall = (method, url, body) =>
  fetch(`http://127.0.0.1:${PORT + 2}${url}`, {
    method,
    headers: { 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => undefined) }));

try {
  // ---- A. Le premier compte arrive par un relais (pas depuis le PC) : l'application Serveur choisit qui reprend les anciennes données
  await start(4397);
  console.log('Mise à niveau vers les comptes');
  let r = await call('GET', '/api/auth/state');
  assert.equal(r.json.hasUsers, false);
  // Un compte créé depuis un autre appareil (accès réseau) n'est pas « le PC » : les anciennes données ne sont pas distribuées toutes seules.
  assert.equal((await ccall('PUT', '/api/console/remote', { enabled: true })).status, 200);
  const relayed = await fetch(`http://127.0.0.1:${PORT + 1}/api/auth/register`, {
    method: 'POST',
    headers: { 'x-mb': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'Chef@Example.com', name: 'Le chef', password: 'motdepasse-du-chef' }),
  });
  assert.equal(relayed.status, 201, 'le tout premier compte est toujours possible');
  const chefNet = /mb_session=[^;]+/.exec(relayed.headers.get('set-cookie') ?? '')[0];
  await sleep(1500);
  assert.deepEqual((await call('GET', '/api/playlists', undefined, chefNet)).json, [], 'rien n\'est repris depuis un autre appareil');
  let users = (await ccall('GET', '/api/console/users')).json;
  assert.deepEqual(users.legacy, { playlists: 1, favorites: 1 });
  ok('Premier compte venu d\'un autre appareil : il est créé, mais les anciennes données restent en attente (signalées dans l\'application Serveur)');

  const chefId = users.users[0].id;
  assert.equal((await ccall('POST', `/api/console/users/${chefId}/adopt`)).status, 200);
  assert.deepEqual((await ccall('GET', '/api/console/users')).json.legacy, { playlists: 0, favorites: 0 });
  assert.deepEqual((await call('GET', '/api/playlists', undefined, chefNet)).json.map((p) => p.name), ['Ancienne playlist']);
  assert.deepEqual((await call('GET', '/api/favorites/ids', undefined, chefNet)).json, [1]);
  const home = (await call('GET', '/api/home', undefined, chefNet)).json;
  assert.equal(home.favoriteCount, 1);
  assert.equal(home.mostPlayed[0]?.id, 1);
  assert.equal(home.mostPlayed[0]?.playCount, 3);
  ok('L\'application Serveur attribue les anciennes playlists, likes et écoutes au compte choisi');

  r = await call('POST', '/api/auth/register', { email: 'invite@example.com', password: 'motdepasse1' });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.isAdmin, undefined);
  const guest = /mb_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')[0];
  assert.deepEqual((await call('GET', '/api/playlists', undefined, guest)).json, []);
  assert.deepEqual((await call('GET', '/api/favorites/ids', undefined, guest)).json, []);
  assert.equal((await call('GET', '/api/home', undefined, guest)).json.mostPlayed.length, 0);
  assert.equal((await call('GET', '/api/tracks', undefined, guest)).json.length >= 1, true, 'la musique, elle, est commune');
  ok('Un autre compte voit la même musique mais aucune donnée personnelle des autres');

  // Secours : mot de passe oublié (outil en ligne de commande sur le serveur)
  const reset = (mail) =>
    spawnSync('node', ['--no-warnings', 'server/dist/server.mjs', 'reset-password', mail], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });
  let out = reset('inconnu@example.com');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /Aucun compte/);
  assert.equal(reset('pas-un-mail').status, 2);
  out = reset('CHEF@example.com');
  assert.equal(out.status, 0, out.stderr);
  const temp = /: (\S+)\s*$/m.exec(out.stdout.split('\n').find((l) => l.includes('Mot de passe provisoire')))[1];
  assert.equal((await call('GET', '/api/tracks', undefined, chefNet)).status, 401, 'ses appareils sont déconnectés');
  assert.equal((await call('POST', '/api/auth/login', { email: 'chef@example.com', password: 'motdepasse-du-chef' })).status, 401);
  r = await call('POST', '/api/auth/login', { email: 'chef@example.com', password: temp });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.mustChange, true);
  ok('Mot de passe oublié : l\'outil du serveur crée un mot de passe provisoire (changement exigé à la connexion)');
  await stop();

  // ---- B. Le premier compte est créé depuis le PC : il reprend tout de suite les anciennes données
  await start(4395);
  assert.equal((await call('GET', '/api/auth/state')).json.hasUsers, false);
  assert.deepEqual((await ccall('GET', '/api/console/users')).json.legacy, { playlists: 1, favorites: 1 });
  r = await call('POST', '/api/auth/register', { email: 'moi@example.com', name: 'Moi', password: 'motdepasse1' });
  assert.equal(r.status, 201);
  const me = /mb_session=[^;]+/.exec(r.headers.get('set-cookie') ?? '')[0];
  await sleep(1500);
  assert.deepEqual((await call('GET', '/api/playlists', undefined, me)).json.map((p) => p.name), ['Ancienne playlist']);
  assert.deepEqual((await call('GET', '/api/favorites/ids', undefined, me)).json, [1]);
  assert.equal((await call('GET', '/api/home', undefined, me)).json.mostPlayed[0]?.playCount, 3);
  assert.deepEqual((await ccall('GET', '/api/console/users')).json.legacy, { playlists: 0, favorites: 0 });
  ok('Premier compte créé depuis ce PC : il reprend les playlists, likes et écoutes d\'avant les comptes');
  await stop();

  console.log(`\n${passed} vérifications réussies.`);
} catch (e) {
  console.error('\nÉCHEC :', e);
  console.error('--- journal du serveur ---\n' + logs);
  process.exitCode = 1;
} finally {
  server?.kill();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
