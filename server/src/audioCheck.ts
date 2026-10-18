import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { parseStream } from 'music-metadata';
import { HttpError } from './util';

/** Type MIME annoncé à l'analyseur, d'après l'extension. */
const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};

const ascii = (b: Buffer, from: number, to: number) => b.toString('latin1', from, to);

/** Début de fichier : les premiers octets d'un vrai fichier audio de ce format (signature). */
export function hasAudioSignature(head: Buffer, ext: string): boolean {
  if (head.length < 12) return false;
  const id3 = ascii(head, 0, 3) === 'ID3'; // étiquettes placées avant le son (MP3, AAC, FLAC)
  switch (ext) {
    case '.mp3':
      return id3 || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
    case '.aac':
      return id3 || (head[0] === 0xff && (head[1]! & 0xf0) === 0xf0);
    case '.flac':
      return id3 || ascii(head, 0, 4) === 'fLaC';
    case '.ogg':
    case '.oga':
    case '.opus':
      return ascii(head, 0, 4) === 'OggS';
    case '.wav':
      return ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE';
    case '.m4a':
      return ascii(head, 4, 8) === 'ftyp';
    default:
      return false;
  }
}

const REFUSED = 415;

/**
 * Vérifie qu'un fichier reçu est bien un fichier audio : sa signature correspond à son extension,
 * l'analyseur y trouve un vrai son (fréquence d'échantillonnage, durée) et aucune vidéo.
 * Lève une erreur 415 expliquant le refus sinon. À appeler AVANT de ranger le fichier.
 */
export async function assertAudioFile(file: string, ext: string): Promise<void> {
  const fd = await fsp.open(file, 'r');
  let head: Buffer;
  try {
    head = Buffer.alloc(16);
    const { bytesRead } = await fd.read(head, 0, 16, 0);
    head = head.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
  if (!hasAudioSignature(head, ext)) {
    throw new HttpError(REFUSED, `Ce fichier n'est pas un vrai fichier ${ext.slice(1).toUpperCase()} : son contenu ne correspond pas à son extension.`);
  }

  const size = (await fsp.stat(file)).size;
  const stream = fs.createReadStream(file);
  try {
    const meta = await parseStream(stream, { mimeType: MIME[ext], size }, { duration: true });
    if (meta.format.hasVideo) throw new HttpError(REFUSED, 'Ce fichier contient de la vidéo : seuls les fichiers audio sont acceptés.');
    if (!meta.format.sampleRate || !(meta.format.numberOfChannels ?? 1)) throw new HttpError(REFUSED, 'Aucun son audio lisible dans ce fichier.');
    if (meta.format.duration !== undefined && !(meta.format.duration > 0)) throw new HttpError(REFUSED, 'Ce fichier audio est vide ou illisible.');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(REFUSED, 'Ce fichier est corrompu ou n’est pas un fichier audio lisible.');
  } finally {
    stream.destroy();
  }
}
