// Test de bout en bout du serveur : node scripts/smoke-test.mjs <dossier-de-test-audio>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const libDir = process.argv[2];
if (!libDir) throw new Error('Indique le dossier de musique de test.');
const PORT = 4398;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-smoke-'));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-public-'));
fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
fs.mkdirSync(path.join(publicDir, 'assets'));
fs.writeFileSync(path.join(publicDir, 'assets', 'app.js'), 'console.log(1)');

const server = spawn('node', ['--no-warnings', 'server/dist/server.mjs'], {
  env: { ...process.env, UPDATE_DISABLED: '1', DATA_DIR: dataDir, PORT: String(PORT), PUBLIC_DIR: publicDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Cookie de session de l'administrateur (« pot à cookies » du test) ; passer { cookie: '' } pour s'en passer.
let jar = '';
const authed = (url, init = {}) => fetch(base + url, { ...init, headers: { cookie: jar, ...(init.headers ?? {}) } });
async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'x-mb': '1',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(jar ? { cookie: jar } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!('cookie' in headers)) {
    const set = /mb_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
    if (set) jar = set[1] ? `mb_session=${set[1]}` : '';
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}
const get = (u, h) => call('GET', u, undefined, h);

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function waitScan() {
  for (let i = 0; i < 100; i++) {
    const s = (await get('/api/scan')).json;
    if (!s.running && s.finishedAt) return s;
    await sleep(200);
  }
  throw new Error('Analyse trop longue');
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await get('/api/health')).status === 200) break;
    } catch {
      await sleep(100);
    }
  }

  console.log('Sécurité');
  assert.equal((await call('POST', '/api/scan', {}, { 'x-mb': '' })).status, 403);
  ok('POST sans en-tête x-mb refusé');
  assert.equal((await call('POST', '/api/scan', {}, { origin: 'https://evil.example' })).status, 403);
  ok('POST depuis un autre site refusé');
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/health', headers: { host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostStatus, 403);
  ok('Hôte inconnu refusé (DNS rebinding)');

  console.log('Premier démarrage');
  let r = await get('/api/auth/state');
  assert.deepEqual(r.json, { hasUsers: false, signupOpen: true, canSetup: true, user: null });
  for (const u of ['/api/tracks', '/api/home', '/api/settings', '/api/stream/1', '/api/cover/' + 'a'.repeat(40), '/api/remote']) {
    r = await get(u);
    assert.equal(r.status, 401, u);
    assert.equal(r.json.code, 'login');
  }
  assert.equal((await call('PUT', '/api/settings', { musicDirs: [libDir] })).status, 401);
  assert.equal((await get('/api/health')).status, 200);
  ok('Sans compte : données refusées (401), seuls /api/health et l\'état de connexion répondent');

  assert.equal((await call('POST', '/api/auth/register', { email: 'pas-un-mail', password: 'motdepasse1' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { email: 'admin@example.com', password: 'court' })).status, 400);
  r = await call('POST', '/api/auth/register', { email: 'admin@example.com', password: 'motdepasse1' }, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(r.status, 403, 'le premier compte ne se crée pas depuis un relais');
  ok('Adresse invalide, mot de passe trop court, création du premier compte depuis un relais : refusés');

  r = await call('POST', '/api/auth/register', { email: ' Admin@Example.com ', name: 'Tristan', password: 'motdepasse1' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.user.isAdmin, true);
  assert.equal(r.json.user.email, 'admin@example.com');
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.ok(jar.length > 40);
  const adminCk = jar;
  r = await get('/api/auth/state');
  assert.equal(r.json.user.name, 'Tristan');
  assert.equal(r.json.canSetup, false);
  ok('Premier compte = administrateur, connecté aussitôt (cookie HttpOnly)');

  console.log('Réglages et analyse');
  r = await call('PUT', '/api/settings', { musicDirs: ['/chemin/inexistant'] });
  assert.equal(r.status, 400);
  ok('Dossier inexistant refusé');
  r = await call('PUT', '/api/settings', { musicDirs: [libDir] });
  assert.equal(r.status, 200);
  let scan = await waitScan();
  assert.equal(scan.added, 31, `31 titres attendus, reçu ${scan.added}`);
  assert.equal(scan.errors, 1, 'le fichier corrompu doit compter pour une erreur');
  ok(`Analyse initiale : ${scan.added} ajoutés, ${scan.errors} erreur (fichier corrompu ignoré)`);

  const stats = (await get('/api/stats')).json;
  assert.equal(stats.tracks, 31);
  assert.equal(stats.albums, 9); // 7 albums + compilation + « Album inconnu »
  ok(`Stats : ${stats.tracks} titres, ${stats.albums} albums, ${stats.artists} artistes`);

  const albums = (await get('/api/albums')).json;
  const byTitle = Object.fromEntries(albums.map((a) => [a.title, a]));
  assert.ok(byTitle['Lemonade'] && byTitle['Lemonade'].trackCount === 5);
  assert.equal(byTitle['Lemonade'].artist, 'Beyoncé');
  assert.equal(byTitle['Lemonade'].year, 2016);
  assert.ok(byTitle['Lemonade'].cover, 'pochette intégrée extraite');
  assert.ok(byTitle['Discovery'].cover, 'pochette de dossier (folder.png) trouvée');
  assert.ok(byTitle['Wild Is the Wind'].cover, 'pochette de dossier pour un album FLAC');
  assert.ok(byTitle['Pastel Blues'] && byTitle['Pastel Blues'].trackCount === 4, 'OGG lu');
  assert.ok(byTitle['Random Access Memories'].trackCount === 3, 'M4A lu');
  assert.equal(byTitle["Now That's Music"].trackCount, 3);
  assert.equal(byTitle["Now That's Music"].artist, 'Various Artists');
  assert.ok(byTitle['Album inconnu'], 'fichier sans tags regroupé');
  ok('Albums, années, pochettes, formats (MP3, FLAC, M4A, OGG), compilation');

  const alt = albums.find((a) => a.title === 'An Awesome Wave');
  const altDetail = (await get(`/api/albums/${alt.id}`)).json;
  assert.deepEqual(altDetail.tracks.map((t) => t.trackNo), [1, 2, 3, 4]);
  assert.equal(altDetail.tracks[1].artist, 'alt-J feat. Invité');
  assert.equal(altDetail.tracks[1].albumArtist, 'alt-J');
  assert.equal(altDetail.artist, 'alt-J', "l'invité ne crée pas un autre album");
  ok('Ordre des pistes, invités (feat.) rattachés au bon artiste');

  const artists = (await get('/api/artists')).json;
  assert.ok(artists.find((a) => a.name === 'Daft Punk' && a.albumCount === 2 && a.trackCount === 7));
  const dp = artists.find((a) => a.name === 'Daft Punk');
  const dpDetail = (await get(`/api/artists/${dp.id}`)).json;
  assert.equal(dpDetail.albums.length, 2);
  assert.equal(dpDetail.albums[0].title, 'Random Access Memories', 'albums triés du plus récent au plus ancien');
  ok('Artistes et discographie');

  const genres = (await get('/api/genres')).json;
  assert.ok(genres.find((g) => g.name === 'Jazz' && g.trackCount === 7));
  assert.equal((await get('/api/tracks?genre=jazz')).json.length, 7);
  ok('Genres et filtre par genre (insensible à la casse)');

  const allTracks = (await get('/api/tracks?sort=title')).json;
  assert.equal(allTracks.length, 31);
  const mystere = allTracks.find((t) => t.title === 'mystère');
  assert.ok(mystere, 'titre déduit du nom de fichier');
  assert.equal(mystere.artist, 'Artiste inconnu');
  ok('Fichier sans étiquettes : titre déduit du nom de fichier');

  console.log('Recherche');
  assert.ok((await get('/api/search?q=beyonce')).json.artists.some((a) => a.name === 'Beyoncé'));
  assert.ok((await get('/api/search?q=etienne%20daho')).json.artists.some((a) => a.name === 'Étienne Daho'));
  assert.ok((await get('/api/search?q=eden')).json.albums.some((a) => a.title === 'Éden'));
  assert.equal((await get('/api/search?q=zzzzzz')).json.tracks.length, 0);
  assert.equal((await get('/api/search?q=')).json.tracks.length, 0);
  ok('Recherche sans accents ni casse (beyonce → Beyoncé)');

  console.log('Lecture (streaming)');
  const track = allTracks.find((t) => t.format === 'MP3');
  const full = await authed(`/api/stream/${track.id}`);
  const size = Number(full.headers.get('content-length'));
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.equal(full.status, 200);
  assert.equal(bytes.length, size);
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  ok(`Fichier complet servi (${size} octets, audio/mpeg)`);
  const part = await authed(`/api/stream/${track.id}`, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200));
  const tail = await authed(`/api/stream/${track.id}`, { headers: { range: 'bytes=-50' } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(size - 50));
  const open = await authed(`/api/stream/${track.id}`, { headers: { range: `bytes=${size - 10}-` } });
  assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(size - 10));
  const bad = await authed(`/api/stream/${track.id}`, { headers: { range: `bytes=${size + 5}-` } });
  assert.equal(bad.status, 416);
  await bad.arrayBuffer();
  ok('Requêtes Range (début-fin, fin ouverte, derniers octets, hors limites → 416)');
  const flac = allTracks.find((t) => t.format === 'FLAC');
  const f = await authed(`/api/stream/${flac.id}`);
  assert.equal(f.headers.get('content-type'), 'audio/flac');
  await f.arrayBuffer();
  assert.equal((await get('/api/stream/999999')).status, 404);
  assert.equal((await get('/api/stream/abc')).status, 400);
  ok('Types MIME FLAC, 404 et 400');

  const cover = await authed(`/api/cover/${byTitle['Lemonade'].cover}`);
  assert.equal(cover.status, 200);
  assert.match(cover.headers.get('content-type'), /^image\//);
  assert.match(cover.headers.get('cache-control'), /immutable/);
  await cover.arrayBuffer();
  assert.equal((await get('/api/cover/..%2f..%2fetc%2fpasswd')).status, 404);
  assert.equal((await get(`/api/cover/${'0'.repeat(40)}`)).status, 404);
  ok('Pochettes servies (cache longue durée), clés invalides refusées');

  console.log('Playlists');
  r = await call('POST', '/api/playlists', { name: '  Road trip  ', description: 'Pour la route' });
  assert.equal(r.status, 200);
  const pl = r.json;
  assert.equal(pl.name, 'Road trip');
  assert.equal((await call('POST', '/api/playlists', { name: '   ' })).status, 400);
  const ids = allTracks.slice(0, 5).map((t) => t.id);
  r = await call('POST', `/api/playlists/${pl.id}/tracks`, { trackIds: [...ids, 999999] });
  assert.equal(r.json.added, 5, 'les titres inconnus sont ignorés');
  await call('POST', `/api/playlists/${pl.id}/tracks`, { trackIds: [ids[0]] });
  let detail = (await get(`/api/playlists/${pl.id}`)).json;
  assert.equal(detail.tracks.length, 6);
  assert.equal(detail.tracks[5].id, ids[0], 'un titre peut figurer deux fois');
  assert.notEqual(detail.tracks[0].entryId, detail.tracks[5].entryId);
  ok('Création, ajout (doublon autorisé, titre inconnu ignoré)');

  const entries = detail.tracks.map((t) => t.entryId);
  const reordered = [entries[5], ...entries.slice(0, 5)];
  assert.equal((await call('PUT', `/api/playlists/${pl.id}/order`, { entryIds: reordered })).status, 200);
  detail = (await get(`/api/playlists/${pl.id}`)).json;
  assert.deepEqual(detail.tracks.map((t) => t.entryId), reordered);
  assert.equal((await call('PUT', `/api/playlists/${pl.id}/order`, { entryIds: entries.slice(1) })).status, 409);
  ok('Réorganisation (et refus si la liste ne correspond plus)');

  assert.equal((await call('DELETE', `/api/playlists/${pl.id}/entries/${reordered[0]}`)).status, 200);
  detail = (await get(`/api/playlists/${pl.id}`)).json;
  assert.equal(detail.tracks.length, 5);
  assert.ok(detail.covers.length >= 1);
  r = await call('PATCH', `/api/playlists/${pl.id}`, { name: 'Roadtrip 2' });
  assert.equal(r.json.name, 'Roadtrip 2');
  assert.equal((await get('/api/playlists')).json.length, 1);
  ok('Retrait d\'un titre, renommage, mosaïque de pochettes');

  console.log('Favoris et historique');
  assert.equal((await call('PUT', `/api/favorites/${ids[0]}`)).status, 200);
  await sleep(5); // deux likes dans la même milliseconde n'ont pas d'ordre garanti
  await call('PUT', `/api/favorites/${ids[1]}`);
  await call('PUT', `/api/favorites/${ids[0]}`); // idempotent
  assert.deepEqual((await get('/api/favorites/ids')).json, [ids[1], ids[0]]);
  assert.equal((await get('/api/favorites')).json.length, 2);
  assert.equal((await call('PUT', '/api/favorites/999999')).status, 404);
  await call('DELETE', `/api/favorites/${ids[1]}`);
  assert.deepEqual((await get('/api/favorites/ids')).json, [ids[0]]);
  ok('Likes (idempotent, titre inconnu → 404)');

  assert.equal((await call('POST', '/api/plays', { trackId: ids[2] })).status, 200);
  await call('POST', '/api/plays', { trackId: ids[2] });
  await call('POST', '/api/plays', { trackId: ids[3] });
  const home = (await get('/api/home')).json;
  assert.equal(home.mostPlayed[0].id, ids[2]);
  assert.equal(home.mostPlayed[0].playCount, 2);
  assert.ok(home.recentAlbums.length >= 1);
  assert.equal(home.favoriteCount, 1);
  assert.equal(home.playlists.length, 1);
  assert.ok(home.recentlyAdded.length > 0 && home.discover.length > 0);
  ok('Historique d\'écoute et page d\'accueil');

  const batch = (await call('POST', '/api/tracks/batch', { ids: [ids[3], 999999, ids[0]] })).json;
  assert.deepEqual(batch.map((t) => t.id), [ids[3], ids[0]]);
  ok('Récupération de titres par identifiants (ordre conservé)');

  console.log('Mises à jour de la bibliothèque');
  const orphanDir = path.join(libDir, 'Nina Simone', 'Pastel Blues');
  const moved = path.join(libDir, 'Déplacé');
  fs.mkdirSync(moved);
  const victim = allTracks.find((t) => t.title === 'Pastel Blues - Titre 1');
  await call('PUT', `/api/favorites/${victim.id}`);
  const victimFile = fs.readdirSync(orphanDir).find((n) => n.startsWith('01'));
  fs.renameSync(path.join(orphanDir, victimFile), path.join(moved, 'renommé.ogg'));
  await call('POST', '/api/scan', {});
  await sleep(300);
  scan = await waitScan();
  assert.equal(scan.removed, 0, 'un fichier déplacé n\'est pas supprimé');
  assert.equal(scan.added, 0);
  assert.equal(scan.updated, 1);
  assert.ok((await get('/api/favorites/ids')).json.includes(victim.id), 'le like survit au déplacement');
  assert.equal((await get('/api/stats')).json.tracks, 31);
  ok('Fichier déplacé : même titre, like conservé');

  fs.unlinkSync(path.join(moved, 'renommé.ogg'));
  await call('POST', '/api/scan', {});
  await sleep(300);
  scan = await waitScan();
  assert.equal(scan.removed, 1);
  assert.equal((await get('/api/stats')).json.tracks, 30);
  assert.ok(!(await get('/api/favorites/ids')).json.includes(victim.id));
  ok('Fichier supprimé : retiré de la bibliothèque et des favoris');

  await call('POST', '/api/scan', {});
  await sleep(300);
  scan = await waitScan();
  assert.equal(scan.added + scan.updated + scan.removed, 0);
  ok('Analyse suivante sans changement : rien à faire (incrémentale)');

  // Dossier déconnecté : on ne supprime rien
  r = await call('PUT', '/api/settings', { musicDirs: [libDir, moved] });
  await waitScan();
  fs.rmSync(moved, { recursive: true });
  await call('POST', '/api/scan', {});
  await sleep(300);
  scan = await waitScan();
  assert.equal((await get('/api/stats')).json.tracks, 30);
  assert.ok(scan.warnings.length >= 1, 'avertissement pour le dossier introuvable');
  ok('Dossier disparu : avertissement, titres conservés');

  // Dossier retiré des réglages : ses titres disparaissent
  r = await call('PUT', '/api/settings', { musicDirs: [path.join(libDir, 'Alt-J')] });
  await sleep(300);
  await waitScan();
  assert.equal((await get('/api/stats')).json.tracks, 4);
  assert.equal((await get('/api/stats')).json.albums, 1);
  ok('Dossier retiré des réglages : bibliothèque réduite');

  console.log('Interface (fichiers statiques)');
  r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal((await get('/album/12')).status, 200, 'route côté navigateur → index.html');
  r = await get('/assets/app.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /immutable/);
  assert.equal((await get('/assets/absent.js')).status, 404);
  assert.equal((await get('/api/nimportequoi')).status, 404);
  const traversal = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
  assert.ok([403, 404, 200].includes(traversal.status));
  assert.ok(!(await traversal.text()).includes('root:'));
  ok('index.html, ressources, 404, protection contre la traversée de dossiers');


  console.log('Accès depuis le réseau');
  const RPORT = PORT + 1;
  const rbase = `http://127.0.0.1:${RPORT}`;
  async function rcall(method, url, { cookie, body, headers = {}, mb = true } = {}) {
    const res = await fetch(rbase + url, {
      method,
      headers: {
        ...(mb ? { 'x-mb': '1' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  const cookieOf = (res) => /mb_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0];

  let st = (await get('/api/remote')).json;
  assert.equal(st.enabled, false);
  assert.equal(st.running, false);
  await assert.rejects(() => fetch(rbase + '/api/health'), 'rien n\'écoute tant que l\'accès n\'est pas activé');
  ok('Désactivé par défaut : aucun port ouvert');

  st = (await call('PUT', '/api/remote', { enabled: true })).json;
  assert.equal(st.running, true, JSON.stringify(st));
  assert.ok(Array.isArray(st.addresses));
  assert.equal(st.pairing, undefined, 'plus de code d\'association');
  ok('Activation par l\'administrateur : port ouvert');

  // Visiteur non connecté
  assert.equal((await rcall('GET', '/api/health')).status, 200);
  for (const u of ['/api/tracks', '/api/albums', '/api/stream/1', '/api/settings', '/api/home', '/api/search?q=a']) {
    assert.equal((await rcall('GET', u)).status, 401, u);
  }
  assert.equal((await rcall('GET', '/api/cover/' + 'a'.repeat(40))).status, 401);
  assert.equal((await rcall('POST', '/api/pair', { body: { code: 'AAAA-AAAA' } })).status, 401, 'l\'ancienne association n\'existe plus');
  r = await rcall('GET', '/album/3');
  assert.match(r.text, /<title>test<\/title>/, 'l\'interface se charge : elle affiche l\'écran de connexion');
  assert.equal((await rcall('GET', '/assets/app.js')).status, 200);
  fs.writeFileSync(path.join(publicDir, 'manifest.webmanifest'), '{"name":"t"}');
  r = await rcall('GET', '/manifest.webmanifest');
  assert.equal(r.json?.name, 't', 'le manifeste est lu sans identifiants : il doit rester public');
  r = await rcall('GET', '/api/auth/state');
  assert.deepEqual(r.json, { hasUsers: true, signupOpen: true, canSetup: false, user: null });
  assert.equal((await rcall('POST', '/api/auth/login', { mb: false, body: { email: 'a@b.fr', password: 'x' } })).status, 403);
  ok('Sans connexion : musique refusée (401), interface et état de connexion seuls accessibles');

  // Un visiteur qui prétend être « localhost » n'est pas pour autant le PC
  const forged = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: RPORT, path: '/api/tracks', headers: { host: 'localhost:' + PORT, 'x-mb': '1' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(forged, 401);
  r = await call('GET', '/api/tracks', undefined, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(r.status, 403, 'un relais (Tailscale Serve…) ne passe pas par le serveur du PC');
  ok('Faux « localhost » et requêtes relayées refusés');

  console.log('Comptes');
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
  r = await rcall('POST', '/api/auth/register', {
    body: { email: 'alice@example.com', name: 'Alice', password: 'motdepasse1' },
    headers: { 'user-agent': UA },
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.user.isAdmin, false);
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/, 'pas de Secure en http');
  let alice = cookieOf(r);
  assert.ok(alice && alice.length > 40);
  r = await rcall('POST', '/api/auth/register', { body: { email: 'ALICE@example.com', password: 'motdepasse1' } });
  assert.equal(r.status, 409, 'une adresse ne sert qu\'une fois, majuscules ou non');
  assert.equal((await rcall('POST', '/api/auth/register', { body: { email: 'bad', password: 'motdepasse1' } })).status, 400);
  assert.equal((await rcall('POST', '/api/auth/register', { body: { email: 'x@example.com', password: '1234567' } })).status, 400);
  ok('Inscription ouverte : compte créé (non administrateur), doublons et saisies invalides refusés');

  const wrong = await rcall('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'pas-le-bon' } });
  const unknown = await rcall('POST', '/api/auth/login', { body: { email: 'personne@example.com', password: 'pas-le-bon' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.text, unknown.text, 'même message : on ne révèle pas quelles adresses existent');
  r = await rcall('POST', '/api/auth/login', { body: { email: 'Alice@Example.com', password: 'motdepasse1' }, headers: { 'user-agent': UA } });
  assert.equal(r.status, 200, r.text);
  const alice2 = cookieOf(r);
  assert.notEqual(alice2, alice);
  r = await rcall('GET', '/api/auth/sessions', { cookie: alice2 });
  assert.equal(r.json.length, 2);
  assert.equal(r.json[0].device, 'Pixel 7');
  assert.equal(r.json.filter((x) => x.current).length, 1);
  ok('Connexion (e-mail sans casse), erreurs identiques, appareils listés avec leur nom');

  // Ce que voit une personne ordinaire
  r = await rcall('GET', '/api/tracks', { cookie: alice });
  assert.equal(r.status, 200);
  assert.ok(r.json.length > 0);
  const aTrack = r.json[0].id;
  const bTrack = r.json[1].id;
  assert.equal((await rcall('GET', `/api/stream/${aTrack}`, { cookie: alice, headers: { range: 'bytes=0-99' } })).status, 206);
  r = await rcall('GET', '/api/settings', { cookie: alice });
  assert.equal(r.json.local, false);
  assert.deepEqual(r.json.musicDirs, []);
  assert.equal(r.json.dataDir, '');
  assert.equal(r.json.uploadsDir, '');
  assert.equal(r.json.canBrowse, false);
  assert.equal((await rcall('PUT', '/api/favorites/1', { cookie: alice, headers: { origin: 'https://evil.example' } })).status, 403);
  ok('Personne ordinaire : bibliothèque et lecture (Range) ; réglages du serveur masqués ; origine étrangère refusée');

  for (const [m, u, b] of [
    ['PUT', '/api/settings', { musicDirs: [] }],
    ['PUT', '/api/autostart', { enabled: true }],
    ['GET', '/api/autostart', undefined],
    ['POST', '/api/scan', {}],
    ['POST', '/api/shutdown', undefined],
    ['POST', '/api/settings/browse', undefined],
    ['POST', '/api/update/check', undefined],
    ['GET', '/api/remote', undefined],
    ['PUT', '/api/remote', { enabled: false }],
    ['GET', '/api/admin/users', undefined],
    ['POST', '/api/admin/users', { email: 'z@example.com', password: 'motdepasse1' }],
    ['PUT', '/api/admin/signup', { open: false }],
    ['PATCH', '/api/admin/users/1', { isAdmin: false }],
    ['POST', '/api/admin/users/1/reset', undefined],
    ['DELETE', '/api/admin/users/1', undefined],
  ]) {
    assert.equal((await rcall(m, u, { cookie: alice, body: b })).status, 403, `${m} ${u}`);
  }
  assert.equal((await get('/api/remote')).json.running, true, 'le serveur tourne toujours');
  ok('Dossiers, analyse, arrêt, mises à jour, accès réseau et comptes : refusés à une personne ordinaire');

  // Données personnelles
  r = await call('POST', '/api/playlists', { name: 'Playlist admin' });
  const adminPl = r.json.id;
  await call('POST', `/api/playlists/${adminPl}/tracks`, { trackIds: [aTrack] });
  await call('PUT', `/api/favorites/${aTrack}`);
  await call('POST', '/api/plays', { trackId: aTrack });
  await call('POST', '/api/plays', { trackId: aTrack });
  r = await rcall('POST', '/api/playlists', { cookie: alice, body: { name: 'Playlist Alice' } });
  const alicePl = r.json.id;
  assert.notEqual(alicePl, adminPl);
  assert.deepEqual((await rcall('GET', '/api/playlists', { cookie: alice })).json.map((p) => p.name), ['Playlist Alice']);
  assert.ok(!(await get('/api/playlists')).json.some((p) => p.name === 'Playlist Alice'));
  for (const [m, u, b] of [
    ['GET', `/api/playlists/${adminPl}`],
    ['PATCH', `/api/playlists/${adminPl}`, { name: 'piraté' }],
    ['POST', `/api/playlists/${adminPl}/tracks`, { trackIds: [bTrack] }],
    ['DELETE', `/api/playlists/${adminPl}`],
  ]) {
    assert.equal((await rcall(m, u, { cookie: alice, body: b })).status, 404, `${m} ${u}`);
  }
  assert.equal((await get(`/api/playlists/${adminPl}`)).json.name, 'Playlist admin');
  assert.equal((await rcall('GET', '/api/favorites/ids', { cookie: alice })).json.length, 0);
  assert.equal((await rcall('GET', '/api/home', { cookie: alice })).json.favoriteCount, 0);
  assert.deepEqual((await rcall('GET', '/api/home', { cookie: alice })).json.mostPlayed, []);
  await rcall('POST', '/api/plays', { cookie: alice, body: { trackId: aTrack } });
  const countFor = async (cookie) => (await rcall('POST', '/api/tracks/batch', { cookie, body: { ids: [aTrack] } })).json[0].playCount;
  assert.equal(await countFor(alice), 1);
  assert.equal(await countFor(adminCk), 2, 'les écoutes de chacun restent séparées');
  assert.ok((await get('/api/favorites/ids')).json.includes(aTrack));
  ok('Playlists, favoris et écoutes : propres à chaque personne (la playlist d\'un autre est introuvable)');

  // Envoi d'un fichier audio (réservé à l'administrateur)
  const findAudio = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        const r = findAudio(f);
        if (r) return r;
      } else if (f.endsWith('.mp3')) return f;
    }
  };
  const sample = fs.readFileSync(findAudio(libDir));
  const uploadsDir = path.join(dataDir, 'Importations');
  const upload = (name, data, { cookie = adminCk, mb = true } = {}) =>
    fetch(`${rbase}/api/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...(mb ? { 'x-mb': '1' } : {}), ...(cookie ? { cookie } : {}) },
      body: data,
    }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => undefined) }));
  const before = (await rcall('GET', '/api/tracks', { cookie: adminCk })).json.length;
  r = await upload('Mon envoi.mp3', sample);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.duplicate, false);
  assert.ok(r.json.track.id > 0 && r.json.track.duration > 0);
  const up1 = r.json.track;
  assert.ok(fs.existsSync(path.join(uploadsDir, 'Mon envoi.mp3')), 'le fichier arrive dans le dossier réservé');
  assert.deepEqual(fs.readdirSync(uploadsDir).filter((f) => f.endsWith('.part')), []);
  assert.equal((await rcall('GET', '/api/tracks', { cookie: adminCk })).json.length, before + 1);
  assert.equal((await rcall('GET', `/api/stream/${up1.id}`, { cookie: adminCk, headers: { range: 'bytes=0-99' } })).status, 206);
  assert.deepEqual((await get('/api/settings')).json.musicDirs.filter((d) => d.includes('Envois')), [], 'pas dans les dossiers de musique');
  assert.equal((await get('/api/settings')).json.uploadsDir, uploadsDir);
  assert.equal((await rcall('GET', '/api/settings', { cookie: alice })).json.uploadsDir, '');
  ok('Envoi depuis le téléphone : fichier rangé dans « Importations », titre analysé, lisible, hors dossiers de musique');

  r = await upload('Mon envoi.mp3', sample);
  assert.equal(r.status, 200);
  assert.equal(r.json.duplicate, true);
  assert.equal(r.json.track.id, up1.id);
  assert.equal(fs.readdirSync(uploadsDir).length, 1);
  ok('Même fichier renvoyé : pas de doublon');

  r = await upload('..\\..\\evil:name?.mp3', Buffer.concat([sample, Buffer.from([0])]));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(fs.readdirSync(uploadsDir).includes('evil name.mp3'), 'nom nettoyé : ' + fs.readdirSync(uploadsDir));
  assert.ok(!fs.existsSync(path.join(dataDir, 'evil name.mp3')));
  ok('Nom de fichier nettoyé (pas de sortie du dossier réservé)');

  r = await upload('notes.txt', Buffer.from('bonjour'));
  assert.equal(r.status, 415);
  r = await upload('faux.mp3', Buffer.from('ceci n\'est pas de l\'audio'));
  assert.equal(r.status, 415);
  assert.ok(!fs.existsSync(path.join(uploadsDir, 'faux.mp3')), 'fichier illisible supprimé');
  assert.equal((await upload('vide.mp3', Buffer.alloc(0))).status, 400);
  ok('Extension inconnue, fichier illisible ou vide : refusés proprement');

  assert.equal((await upload('x.mp3', sample, { cookie: null })).status, 401);
  assert.equal((await upload('x.mp3', sample, { mb: false })).status, 403);
  r = await upload('x.mp3', sample, { cookie: alice });
  assert.equal(r.status, 403, 'l\'import est réservé à l\'administrateur');
  ok('Envoi refusé sans connexion, à une personne ordinaire, et sans en-tête x-mb');

  console.log('Administration des comptes');
  r = await get('/api/admin/users');
  assert.equal(r.json.users.length, 2);
  assert.equal(r.json.signupOpen, true);
  const aliceRow = r.json.users.find((u) => u.email === 'alice@example.com');
  assert.equal(aliceRow.playlistCount, 1);
  assert.equal(aliceRow.sessionCount, 2);
  const adminId = r.json.users.find((u) => u.isAdmin).id;
  assert.equal(r.json.users[0].isAdmin, true, 'l\'administrateur est listé en premier');
  ok('Liste des comptes : 2 comptes, playlists et appareils comptés');

  // Inscriptions fermées
  r = await call('PUT', '/api/admin/signup', { open: false });
  assert.equal(r.json.signupOpen, false);
  r = await rcall('POST', '/api/auth/register', { body: { email: 'intrus@example.com', password: 'motdepasse1' } });
  assert.equal(r.status, 403);
  assert.equal((await rcall('GET', '/api/auth/state')).json.signupOpen, false);
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'motdepasse1' } })).status, 200);
  ok('Inscriptions fermées : nouveaux comptes refusés, les comptes existants se connectent toujours');

  // Compte créé par l'administrateur : mot de passe provisoire
  r = await call('POST', '/api/admin/users', { email: 'bob@example.com', name: 'Bob', password: 'provisoire1' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.users.length, 3);
  r = await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'provisoire1' } });
  assert.equal(r.json.user.mustChange, true);
  const bob = cookieOf(r);
  r = await rcall('GET', '/api/tracks', { cookie: bob });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'must_change');
  assert.equal((await rcall('GET', '/api/auth/state', { cookie: bob })).json.user.mustChange, true);
  assert.equal((await rcall('POST', '/api/auth/password', { cookie: bob, body: { current: 'faux', next: 'nouveaumdp1' } })).status, 400);
  assert.equal((await rcall('POST', '/api/auth/password', { cookie: bob, body: { current: 'provisoire1', next: 'court' } })).status, 400);
  assert.equal((await rcall('POST', '/api/auth/password', { cookie: bob, body: { current: 'provisoire1', next: 'nouveaumdp1' } })).status, 200);
  assert.equal((await rcall('GET', '/api/tracks', { cookie: bob })).status, 200);
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'provisoire1' } })).status, 401);
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'nouveaumdp1' } })).status, 200);
  ok('Mot de passe provisoire : tout est bloqué tant qu\'il n\'est pas changé, puis la personne choisit le sien');

  // Mot de passe oublié : l'administrateur le réinitialise
  const bobId = (await get('/api/admin/users')).json.users.find((u) => u.email === 'bob@example.com').id;
  r = await call('POST', `/api/admin/users/${bobId}/reset`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.password, /^[A-Za-z2-9]{10}$/);
  const temp = r.json.password;
  assert.equal((await rcall('GET', '/api/tracks', { cookie: bob })).status, 401, 'ses appareils sont déconnectés');
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'nouveaumdp1' } })).status, 401);
  r = await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: temp } });
  assert.equal(r.json.user.mustChange, true);
  ok('Réinitialisation : mot de passe provisoire affiché une fois, anciens appareils déconnectés');

  // Désactivation, droits
  assert.equal((await call('PATCH', `/api/admin/users/${bobId}`, { disabled: true })).status, 200);
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: temp } })).status, 401);
  assert.equal((await rcall('GET', '/api/auth/state', { cookie: cookieOf(r) })).json.user, null);
  await call('PATCH', `/api/admin/users/${bobId}`, { disabled: false });
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: temp } })).status, 200);
  ok('Compte désactivé : connexion et sessions coupées ; réactivé : il se reconnecte');

  for (const [m, u, b] of [
    ['PATCH', `/api/admin/users/${adminId}`, { disabled: true }],
    ['PATCH', `/api/admin/users/${adminId}`, { isAdmin: false }],
    ['POST', `/api/admin/users/${adminId}/reset`],
    ['DELETE', `/api/admin/users/${adminId}`],
  ]) {
    assert.equal((await call(m, u, b)).status, 409, `${m} ${u}`);
  }
  assert.equal((await call('PATCH', '/api/admin/users/99999', { disabled: true })).status, 404);
  ok('L\'administrateur ne peut pas se désactiver, se rétrograder, se réinitialiser ni se supprimer');

  const aliceId = aliceRow.id;
  r = await call('PATCH', `/api/admin/users/${aliceId}`, { isAdmin: true });
  assert.equal(r.status, 200);
  assert.equal((await rcall('GET', '/api/admin/users', { cookie: alice })).status, 200, 'rôle appliqué sans reconnexion');
  assert.equal((await rcall('PATCH', `/api/admin/users/${adminId}`, { cookie: alice, body: { isAdmin: false } })).status, 200);
  assert.equal((await rcall('PATCH', `/api/admin/users/${aliceId}`, { cookie: alice, body: { isAdmin: false } })).status, 409);
  await rcall('PATCH', `/api/admin/users/${adminId}`, { cookie: alice, body: { isAdmin: true } });
  assert.equal((await call('PATCH', `/api/admin/users/${aliceId}`, { isAdmin: false })).status, 200);
  ok('Promotion et rétrogradation d\'un compte');

  // Suppression : les données de la personne disparaissent, pas les autres
  assert.equal((await call('DELETE', `/api/admin/users/${aliceId}`)).status, 200);
  assert.equal((await rcall('GET', '/api/tracks', { cookie: alice })).status, 401);
  assert.equal((await rcall('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'motdepasse1' } })).status, 401);
  assert.ok(!(await get('/api/playlists')).json.some((p) => p.name === 'Playlist Alice'));
  assert.equal((await get(`/api/playlists/${adminPl}`)).status, 200);
  assert.equal((await get('/api/admin/users')).json.users.length, 2);
  ok('Suppression d\'un compte : accès coupé, ses playlists supprimées, celles des autres intactes');

  // Déconnexion
  r = await rcall('POST', '/api/auth/logout', { cookie: bob });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await rcall('GET', '/api/tracks', { cookie: bob })).status, 401);
  r = await rcall('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: temp } });
  const bob3 = cookieOf(r);
  const sessions = (await rcall('GET', '/api/auth/sessions', { cookie: bob3 })).json;
  assert.ok(sessions.length >= 1);
  const other = sessions.find((x) => !x.current);
  if (other) {
    assert.equal((await rcall('DELETE', `/api/auth/sessions/${other.id}`, { cookie: bob3 })).status, 200);
  }
  assert.equal((await rcall('DELETE', `/api/auth/sessions/${aliceRow.id}`, { cookie: bob3 })).status, 404, 'on ne retire pas les appareils des autres');
  ok('Déconnexion et retrait d\'un appareil');

  // Limite d'essais
  let blocked = 0;
  for (let i = 0; i < 10; i++) {
    const res = await rcall('POST', '/api/auth/login', { body: { email: 'cible@example.com', password: 'essai-' + i } });
    if (res.status === 429) blocked++;
  }
  assert.ok(blocked >= 2, 'trop d\'essais ratés → 429');
  r = await rcall('POST', '/api/auth/login', { body: { email: 'cible@example.com', password: 'essai-final' } });
  assert.equal(r.status, 429);
  ok('Essais de connexion limités (429 après 8 échecs sur la même adresse)');

  // Arrêt du réseau
  await call('PUT', '/api/remote', { enabled: false });
  await assert.rejects(() => fetch(rbase + '/api/health'));
  assert.equal((await get('/api/remote')).json.running, false);
  ok('Désactivation : le port se ferme');

  // Arrêt : réservé à l'administrateur, ou au jeton local (installateur)
  r = await call('POST', '/api/shutdown', undefined, { cookie: bob3 });
  assert.equal(r.status, 403, 'une personne ordinaire ne peut pas arrêter le serveur');
  assert.equal((await call('POST', '/api/shutdown', undefined, { cookie: '', 'x-mb-token': 'faux' })).status, 401);
  const token = fs.readFileSync(path.join(dataDir, 'server.token'), 'utf8').trim();
  assert.ok(token.length >= 32);
  assert.equal((await call('POST', '/api/shutdown', undefined, { cookie: '', 'x-mb-token': token, 'x-forwarded-for': '203.0.113.9' })).status, 403);
  assert.equal((await call('POST', '/api/shutdown', undefined, { cookie: '' })).status, 401);
  assert.equal((await call('POST', '/api/shutdown', undefined, { cookie: '', 'x-mb-token': token })).status, 200);
  for (let i = 0; i < 30 && server.exitCode === null; i++) await sleep(100);
  assert.equal(server.exitCode, 0, 'le serveur s\'est arrêté');
  ok('Arrêt du serveur : refusé sans droit, accepté avec le jeton local (installateur)');

  console.log(`\n${passed} vérifications réussies.`);
} catch (e) {
  console.error('\nÉCHEC :', e);
  console.error('--- journal du serveur ---\n' + logs);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
}
