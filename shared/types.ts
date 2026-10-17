// Types partagés entre le serveur et l'interface.

export interface Track {
  id: number;
  title: string;
  /** Artiste affiché pour ce titre (peut contenir des invités). */
  artist: string;
  album: string;
  albumId: number;
  /** Id de l'artiste de l'album (sert pour les liens). */
  artistId: number;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  /** Clé de la pochette (voir /api/cover/:key) ou null. */
  cover: string | null;
  format: string;
  addedAt: number;
  playCount: number;
}

export interface PlaylistTrack extends Track {
  /** Identifiant de la ligne dans la playlist (un titre peut y figurer deux fois). */
  entryId: number;
}

export interface Album {
  id: number;
  title: string;
  artist: string;
  artistId: number;
  year: number | null;
  cover: string | null;
  trackCount: number;
  duration: number;
  addedAt: number;
}

export interface AlbumDetail extends Album {
  tracks: Track[];
}

export interface Artist {
  id: number;
  name: string;
  albumCount: number;
  trackCount: number;
  cover: string | null;
}

export interface ArtistDetail extends Artist {
  albums: Album[];
  topTracks: Track[];
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  trackCount: number;
  duration: number;
  covers: string[];
  updatedAt: number;
}

export interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrack[];
}

export interface Genre {
  name: string;
  trackCount: number;
}

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export interface HomeData {
  recentAlbums: Album[];
  recentlyAdded: Album[];
  discover: Album[];
  mostPlayed: Track[];
  playlists: Playlist[];
  favoriteCount: number;
}

export interface ScanStatus {
  running: boolean;
  phase: 'idle' | 'walking' | 'reading' | 'finishing';
  total: number;
  done: number;
  added: number;
  updated: number;
  removed: number;
  errors: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Messages d'avertissement (dossier introuvable, etc.). */
  warnings: string[];
}

export interface Settings {
  musicDirs: string[];
  defaultMusicDir: string;
  platform: string;
  dataDir: string;
  /** Dossier du PC où arrivent les fichiers envoyés depuis le téléphone (vide hors du PC). */
  uploadsDir: string;
  version: string;
  canBrowse: boolean;
  /** Vrai quand la requête vient du PC lui-même (et non d'un téléphone associé). */
  local: boolean;
  /** Nom de l'appareil associé qui fait la requête (null depuis le PC). */
  deviceName: string | null;
}

export interface RemoteDevice {
  id: number;
  name: string;
  createdAt: number;
  lastSeen: number;
}

export interface RemoteAddress {
  ip: string;
  iface: string;
  /** « lan » : réseau de la maison ; « tailscale » : accessible de partout via Tailscale. */
  kind: 'lan' | 'tailscale';
  url: string;
}

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  error: string | null;
  addresses: RemoteAddress[];
  pairing: { code: string; expiresAt: number } | null;
  devices: RemoteDevice[];
}

export interface Stats {
  tracks: number;
  albums: number;
  artists: number;
  playlists: number;
  duration: number;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'downloading' | 'installing' | 'restarting' | 'error';
  /** Version en cours d'exécution. */
  current: string;
  /** Dernière version publiée, une fois la recherche faite. */
  latest: string | null;
  /** Avancement du téléchargement (0 à 1). */
  progress: number;
  checkedAt: number | null;
  error: string | null;
  /** Faux quand l'application tourne depuis les sources (pas de mise à jour automatique). */
  canInstall: boolean;
}
