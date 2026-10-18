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
  /** Débit binaire moyen du fichier en kbit/s (null si inconnu). */
  bitrate: number | null;
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

/** Ce que le lecteur a besoin de savoir du serveur. */
export interface AppInfo {
  version: string;
  /** Vrai quand la requête vient du PC qui héberge le serveur. */
  local: boolean;
}

/** Application « Serveur » : réglages et chemins du serveur. */
export interface ConsoleInfo {
  version: string;
  platform: string;
  dataDir: string;
  /** Dossier du serveur où arrivent les fichiers importés. */
  uploadsDir: string;
  musicDirs: string[];
  defaultMusicDir: string;
  /** Vrai quand une fenêtre de choix de dossier peut s'ouvrir (Windows). */
  canBrowse: boolean;
  /** Adresse du lecteur sur ce PC. */
  playerUrl: string;
}

/** Compte connecté. */
export interface User {
  id: number;
  email: string;
  name: string;
  /** Mot de passe provisoire (donné depuis l'application Serveur) : à remplacer avant toute chose. */
  mustChange: boolean;
}

export interface AuthState {
  /** Faux tant que personne n'a créé de compte (premier démarrage). */
  hasUsers: boolean;
  signupOpen: boolean;
  user: User | null;
}

/** Appareil connecté à un compte. */
export interface UserSession {
  id: number;
  device: string;
  createdAt: number;
  lastSeen: number;
  current: boolean;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  disabled: boolean;
  mustChange: boolean;
  createdAt: number;
  lastSeen: number | null;
  playlistCount: number;
  sessionCount: number;
}

export interface AdminUsers {
  users: AdminUser[];
  signupOpen: boolean;
  /** Playlists et likes d'avant les comptes, pas encore rattachés à quelqu'un. */
  legacy: { playlists: number; favorites: number };
}

/** Appareil connecté, vu depuis l'application Serveur (tous comptes confondus). */
export interface ConsoleSession {
  id: number;
  userId: number;
  userName: string;
  email: string;
  device: string;
  createdAt: number;
  lastSeen: number;
  /** Actif ces dernières minutes (lecteur ouvert). */
  online: boolean;
  /** Dernier titre lancé depuis cet appareil (ne dit pas qu'il est encore en cours). */
  listening: { title: string; artist: string; at: number } | null;
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
}

export interface Stats {
  tracks: number;
  albums: number;
  artists: number;
  playlists: number;
  duration: number;
}

/** Aperçu du serveur (application Serveur). */
export interface ConsoleStats {
  tracks: number;
  albums: number;
  artists: number;
  duration: number;
  users: number;
  /** Comptes actifs en ce moment. */
  online: number;
  devices: number;
}

/** Un disque (ou volume) qui héberge de la musique ou les données de Spotifree. */
export interface StorageDisk {
  id: string;
  /** « C:\\ » sous Windows. */
  label: string;
  total: number;
  free: number;
}

export interface StorageFolder {
  path: string;
  /** « music » : dossier suivi ; « imports » : dossier des fichiers importés dans Spotifree. */
  kind: 'music' | 'imports';
  exists: boolean;
  tracks: number;
  bytes: number;
  diskId: string | null;
}

export interface StorageFormat {
  format: string;
  tracks: number;
  bytes: number;
}

export interface StorageAlbum {
  id: number;
  title: string;
  artist: string;
  tracks: number;
  bytes: number;
}

/** Application Serveur > Stockage. */
export interface ConsoleStorage {
  disks: StorageDisk[];
  folders: StorageFolder[];
  formats: StorageFormat[];
  biggest: StorageAlbum[];
  library: { tracks: number; bytes: number };
  /** Ce que Spotifree garde pour lui : base de données, pochettes, journaux. */
  app: { dataDir: string; bytes: number; covers: number; database: number; diskId: string | null };
  /** Espace à laisser libre : les importations sont refusées en dessous (en Go). */
  minFreeGb: number;
  at: number;
}

export interface StorageImport {
  name: string;
  bytes: number;
  modifiedAt: number;
  inLibrary: boolean;
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
