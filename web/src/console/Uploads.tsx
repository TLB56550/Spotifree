import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react';
import { useUploads, type UploadItem } from './uploads';

const ACCEPT = 'audio/*,.mp3,.flac,.m4a,.aac,.ogg,.oga,.opus,.wav';

/** Bouton « Choisir des fichiers » : ouvre le sélecteur de fichiers de Windows. */
export function UploadPicker() {
  const input = useRef<HTMLInputElement>(null);
  const add = useUploads((s) => s.add);
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
      <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
        <Upload /> Choisir des fichiers…
      </button>
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
      return 'Déjà importé';
    default:
      return it.error ?? 'Échec';
  }
}

/** Liste des importations en cours et terminées. */
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

/** Glisser-déposer : des fichiers audio lâchés n'importe où sur la fenêtre sont importés. */
export function DropHint() {
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
  if (!over) return null;
  return (
    <div className="drop-hint" aria-hidden>
      <Upload />
      <span>Dépose tes fichiers audio pour les importer</span>
    </div>
  );
}

/** Pastille dans la barre latérale pendant qu'une importation est en cours. */
export function UploadPill() {
  const items = useUploads((s) => s.items);
  const active = items.filter((it) => it.status === 'waiting' || it.status === 'sending');
  if (!active.length) return null;
  const current = active.find((it) => it.status === 'sending') ?? active[0]!;
  const pct = current.size ? Math.round((current.loaded / current.size) * 100) : 0;
  return (
    <div className="c-upload-pill" role="status">
      <Loader2 className="spin" aria-hidden />
      <span>
        Importation · {active.length > 1 ? `${active.length} fichiers` : '1 fichier'} · {pct} %
      </span>
    </div>
  );
}
