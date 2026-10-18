import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react';
import { useUploads, type UploadItem } from '../store/uploads';

const ACCEPT = 'audio/*,.mp3,.flac,.m4a,.aac,.ogg,.oga,.opus,.wav';

/** Bouton « Envoyer vers le serveur » : ouvre le sélecteur de fichiers du téléphone. */
export function UploadPicker({ variant }: { variant: 'row' | 'button' | 'nav' }) {
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
      {variant === 'nav' ? (
        <button type="button" className="nav-item nav-button" onClick={open}>
          <Upload />
          <span>Importer des fichiers</span>
        </button>
      ) : variant === 'row' ? (
        <button type="button" className="lib-row lib-new" onClick={open}>
          <span className="lib-cover lib-plus">
            <Upload aria-hidden />
          </span>
          <span className="lib-text">
            <span className="lib-title">Envoyer de la musique vers le serveur</span>
            <span className="lib-sub">Choisis des fichiers audio de cet appareil</span>
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
      return 'Ajouté';
    case 'duplicate':
      return 'Déjà sur le serveur';
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

/** Pour l'administrateur : liste flottante des importations, avec glisser-déposer de fichiers sur la fenêtre. */
export function UploadFloat() {
  const items = useUploads((s) => s.items);
  const add = useUploads((s) => s.add);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      add(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [add]);
  return (
    <>
      {over && (
        <div className="drop-hint" aria-hidden>
          <Upload />
          <span>Dépose tes fichiers audio pour les importer</span>
        </div>
      )}
      {items.length > 0 && (
        <div className="upload-float" role="status">
          <UploadList />
        </div>
      )}
    </>
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
        Envoi vers le serveur · {active.length > 1 ? `${active.length} fichiers` : '1 fichier'} · {pct} %
      </span>
      <span className="upload-banner-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
