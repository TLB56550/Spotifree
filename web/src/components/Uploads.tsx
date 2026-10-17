import { useRef } from 'react';
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react';
import { useUploads, type UploadItem } from '../store/uploads';

const ACCEPT = 'audio/*,.mp3,.flac,.m4a,.aac,.ogg,.oga,.opus,.wav';

/** Bouton « Envoyer vers le PC » : ouvre le sélecteur de fichiers du téléphone. */
export function UploadPicker({ variant }: { variant: 'row' | 'button' }) {
  const input = useRef<HTMLInputElement>(null);
  const add = useUploads((s) => s.add);
  const open = () => input.current?.click();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {variant === 'row' ? (
        <button type="button" className="lib-row lib-new" onClick={open}>
          <span className="lib-cover lib-plus">
            <Upload aria-hidden />
          </span>
          <span className="lib-text">
            <span className="lib-title">Envoyer de la musique vers le PC</span>
            <span className="lib-sub">Choisis des fichiers audio de ce téléphone</span>
          </span>
        </button>
      ) : (
        <button type="button" className="btn" onClick={open}>
          <Upload /> Choisir des fichiers
        </button>
      )}
    </>
  );
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

function status(it: UploadItem): string {
  switch (it.status) {
    case 'waiting':
      return 'En attente';
    case 'sending':
      return `${it.size ? Math.round((it.loaded / it.size) * 100) : 0} %`;
    case 'done':
      return 'Envoyé';
    case 'duplicate':
      return 'Déjà sur le PC';
    default:
      return it.error ?? 'Échec';
  }
}

/** Liste des envois en cours et terminés. */
export function UploadList() {
  const items = useUploads((s) => s.items);
  const clear = useUploads((s) => s.clearFinished);
  if (!items.length) return null;
  const finished = items.some((it) => it.status !== 'waiting' && it.status !== 'sending');
  return (
    <div className="uploads">
      <ul>
        {items.map((it) => (
          <li key={it.id} className={`upload is-${it.status}`}>
            <span className="upload-icon" aria-hidden>
              {it.status === 'done' || it.status === 'duplicate' ? <Check /> : it.status === 'error' ? <AlertCircle /> : it.status === 'sending' ? <Loader2 className="spin" /> : <Upload />}
            </span>
            <span className="upload-text">
              <span className="upload-name">{it.name}</span>
              <span className="upload-sub">
                {size(it.size)} · {status(it)}
              </span>
              {it.status === 'sending' && (
                <span className="progress">
                  <span style={{ width: `${it.size ? (it.loaded / it.size) * 100 : 0}%` }} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {finished && (
        <button type="button" className="btn btn-ghost" onClick={clear}>
          Effacer la liste
        </button>
      )}
    </div>
  );
}

/** Bandeau au-dessus du lecteur pendant qu'un envoi est en cours. */
export function UploadBanner() {
  const items = useUploads((s) => s.items);
  const active = items.filter((it) => it.status === 'waiting' || it.status === 'sending');
  if (!active.length) return null;
  const current = active.find((it) => it.status === 'sending') ?? active[0]!;
  const pct = current.size ? Math.round((current.loaded / current.size) * 100) : 0;
  return (
    <div className="upload-banner" role="status">
      <Upload aria-hidden />
      <span>
        Envoi vers le PC · {active.length > 1 ? `${active.length} fichiers` : '1 fichier'} · {pct} %
      </span>
      <span className="upload-banner-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
