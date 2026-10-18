import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateStatus } from '../../shared/types';
import { VERSION, isWin } from './config';
import { installedDirs } from './desktop';
import { errMsg } from './util';

/** Code de sortie qui demande au lanceur (« Lancer Spotifree.bat ») de redémarrer l'application. */
export const EXIT_RESTART = 75;

const REPO = 'TLB56550/Spotifree';
// Source principale : le flux Atom des publications (pas de limite d'appels, contrairement à l'API GitHub, limitée à 60/heure par adresse).
const FEED_URL = process.env.UPDATE_FEED_URL || `https://github.com/${REPO}/releases.atom`;
const DOWNLOAD_BASE = process.env.UPDATE_DOWNLOAD_BASE || `https://github.com/${REPO}/releases/download`;
// Secours : l'API GitHub.
const API_URL = process.env.UPDATE_API_URL || `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const ASSET_NAME = 'Ma-Bibliotheque-app.tar.gz';
const MAX_BUNDLE = 150 * 1024 * 1024;

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** > 0 si a est plus récente que b. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}
interface GhRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GhAsset[];
}
export interface Candidate {
  version: string;
  url: string;
  size: number;
  sha256Url: string | null;
  sha256: string | null;
}

/** La version « pc-X.Y.Z » la plus récente qui contient le paquet de mise à jour. */
export function pickRelease(releases: GhRelease[]): Candidate | null {
  let best: Candidate | null = null;
  for (const r of releases) {
    const m = /^pc-(\d+\.\d+\.\d+)$/.exec(r.tag_name ?? '');
    if (!m || r.draft || r.prerelease) continue;
    const asset = r.assets?.find((a) => a.name === ASSET_NAME);
    if (!asset) continue;
    const sum = r.assets?.find((a) => a.name === ASSET_NAME + '.sha256');
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '');
    if (!digest && !sum) continue; // sans empreinte, on n'installe rien
    if (!best || compareVersions(m[1]!, best.version) > 0) {
      best = {
        version: m[1]!,
        url: asset.browser_download_url,
        size: asset.size,
        sha256Url: sum?.browser_download_url ?? null,
        sha256: digest ? digest[1]!.toLowerCase() : null,
      };
    }
  }
  return best;
}

/** La version « pc-X.Y.Z » la plus récente d'un flux Atom de publications. */
export function pickFromFeed(xml: string): Candidate | null {
  let best: string | null = null;
  for (const m of xml.matchAll(/releases\/tag\/pc-(\d+\.\d+\.\d+)(?=["<\s])/g)) {
    if (!best || compareVersions(m[1]!, best) > 0) best = m[1]!;
  }
  if (!best) return null;
  const base = `${DOWNLOAD_BASE}/pc-${best}/${ASSET_NAME}`;
  return { version: best, url: base, size: 0, sha256Url: `${base}.sha256`, sha256: null };
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 120_000, windowsHide: true }, (err, _out, stderr) =>
      err ? reject(new Error(`${path.basename(cmd)} : ${String(stderr || err.message).trim()}`)) : resolve(),
    );
  });
}

export class Updater {
  private st: UpdateStatus = {
    state: 'idle',
    current: VERSION,
    latest: null,
    progress: 0,
    checkedAt: null,
    error: null,
    canInstall: false,
  };
  private busy = false;
  /** Dossier « app » à mettre à jour (null = exécution depuis les sources : on se contente de signaler). */
  private appDir: string | null;

  constructor(
    private dataDir: string,
    private log: (msg: string) => void,
    private restart: () => Promise<void>,
  ) {
    this.appDir = installedDirs()?.appDir ?? null;
    this.st.canInstall = this.appDir !== null && parseVersion(VERSION) !== null;
  }

  status(): UpdateStatus {
    return { ...this.st };
  }

  /** Cherche une nouvelle version et, s'il y en a une, la télécharge, l'installe et redémarre. */
  async check(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.st = { ...this.st, state: 'checking', error: null, progress: 0 };
    try {
      const found = await this.find();
      this.st.checkedAt = Date.now();
      if (!found || compareVersions(found.version, VERSION) <= 0) {
        this.st = { ...this.st, state: 'idle', latest: found?.version ?? VERSION };
        return;
      }
      this.st.latest = found.version;
      if (!this.st.canInstall) {
        this.log(`Version ${found.version} disponible (mise à jour automatique indisponible dans cette installation).`);
        this.st.state = 'idle';
        return;
      }
      this.log(`Mise à jour ${VERSION} → ${found.version} : téléchargement…`);
      this.st.state = 'downloading';
      const bundle = await this.download(found);
      this.st = { ...this.st, state: 'installing', progress: 1 };
      await this.install(bundle, found.version);
      this.log(`Version ${found.version} installée : redémarrage.`);
      this.st.state = 'restarting';
      await new Promise((r) => setTimeout(r, 2500)); // laisse l'interface afficher l'écran de mise à jour
      await this.restart();
    } catch (e) {
      this.log(`Mise à jour impossible : ${errMsg(e)}`);
      this.st = { ...this.st, state: 'error', error: errMsg(e), checkedAt: this.st.checkedAt ?? Date.now() };
    } finally {
      this.busy = false;
    }
  }

  private async find(): Promise<Candidate | null> {
    const headers = { 'user-agent': 'ma-bibliotheque' };
    // Le flux Atom d'abord ; l'API seulement s'il est injoignable (ou si seule l'API est configurée, pour les tests).
    if (!process.env.UPDATE_API_URL || process.env.UPDATE_FEED_URL) {
      try {
        const res = await fetch(FEED_URL, { headers, signal: AbortSignal.timeout(10_000) });
        if (res.ok) return pickFromFeed(await res.text());
      } catch {
        // Repli sur l'API.
      }
    }
    const res = await fetch(API_URL, {
      headers: { ...headers, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
    return pickRelease((await res.json()) as GhRelease[]);
  }

  private async download(c: Candidate): Promise<string> {
    let expected = c.sha256;
    if (!expected && c.sha256Url) {
      const res = await fetch(c.sha256Url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) expected = /[0-9a-f]{64}/i.exec(await res.text())?.[0]?.toLowerCase() ?? null;
    }
    if (!expected) throw new Error("empreinte de vérification introuvable");
    if (c.size > MAX_BUNDLE) throw new Error('paquet trop volumineux');
    let total = c.size;

    const dir = path.join(this.dataDir, 'update');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${ASSET_NAME}.part`);
    const res = await fetch(c.url, { redirect: 'follow', signal: AbortSignal.timeout(180_000), headers: { 'user-agent': 'ma-bibliotheque' } });
    if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status})`);
    if (!total) total = Number(res.headers.get('content-length') ?? 0);
    const hash = crypto.createHash('sha256');
    let got = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _e, cb) => {
        got += chunk.length;
        if (got > MAX_BUNDLE) return cb(new Error('paquet trop volumineux'));
        hash.update(chunk);
        if (total > 0) this.st.progress = Math.min(1, got / total);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), meter, fs.createWriteStream(file));
    } catch (e) {
      await fsp.rm(file, { force: true });
      throw e;
    }
    if (hash.digest('hex') !== expected) {
      await fsp.rm(file, { force: true });
      throw new Error('le fichier téléchargé est altéré (empreinte différente)');
    }
    return file;
  }

  private async install(bundle: string, version: string): Promise<void> {
    const appDir = this.appDir!;
    const base = path.join(this.dataDir, 'update');
    const stage = path.join(base, 'stage');
    const backup = path.join(base, 'backup');
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });
    // bsdtar de Windows 10/11 ; chemins relatifs pour éviter que « C: » soit pris pour une machine distante.
    const tar = isWin ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    await run(tar, ['-xzf', path.relative(stage, bundle)], stage);

    const newApp = path.join(stage, 'app');
    const serverFile = path.join(newApp, 'server.mjs');
    if (!fs.existsSync(path.join(newApp, 'public', 'index.html')) || !fs.existsSync(serverFile)) throw new Error('paquet incomplet');
    if (!(await fsp.readFile(serverFile, 'utf8')).includes(JSON.stringify(version))) throw new Error('le paquet ne correspond pas à la version annoncée');

    // Sauvegarde, puis remplacement ; en cas d'échec on remet l'ancienne version.
    await fsp.rm(backup, { recursive: true, force: true });
    await fsp.cp(appDir, backup, { recursive: true });
    try {
      await fsp.rm(path.join(appDir, 'public'), { recursive: true, force: true });
      await fsp.cp(newApp, appDir, { recursive: true, force: true });
    } catch (e) {
      await fsp.rm(path.join(appDir, 'public'), { recursive: true, force: true }).catch(() => {});
      await fsp.cp(backup, appDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`copie impossible, ancienne version conservée (${errMsg(e)})`);
    }
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.rm(bundle, { force: true });
  }
}
