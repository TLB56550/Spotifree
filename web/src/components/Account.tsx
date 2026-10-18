import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Monitor, Smartphone, Trash2 } from 'lucide-react';
import type { UserSession } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { logout, useUser } from '../lib/auth';
import { formatAgo } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';
import { PasswordField } from './AuthPage';

const SESSIONS = ['sessions'];

function NameForm() {
  const user = useUser()!;
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== user.name && name.trim().length > 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/api/auth/me', { name });
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast('Nom enregistré');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impossible d’enregistrer.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-name" onSubmit={(e) => void save(e)}>
      <label className="field">
        <span>Nom affiché</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <button type="submit" className="btn" disabled={busy || !dirty}>
        Enregistrer
      </button>
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/password', { current, next });
      setCurrent('');
      setNext('');
      setAgain('');
      void queryClient.invalidateQueries({ queryKey: SESSIONS });
      toast('Mot de passe modifié. Tes autres appareils sont déconnectés.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Changement impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="account-details">
      <summary>Changer mon mot de passe</summary>
      <form className="auth-form" onSubmit={(e) => void save(e)}>
        <PasswordField label="Mot de passe actuel" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" hint="8 caractères minimum." />
        <PasswordField label="Confirme le nouveau mot de passe" value={again} onChange={setAgain} autoComplete="new-password" />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy || !current || !next || !again}>
          Modifier le mot de passe
        </button>
      </form>
    </details>
  );
}

const isPhone = (device: string) => !/^(PC|Mac|Appareil Linux)/.test(device);

function Devices() {
  const confirm = useUI((s) => s.confirm);
  const { data } = useQuery({ queryKey: SESSIONS, queryFn: () => api.get<UserSession[]>('/api/auth/sessions') });
  if (!data || data.length < 2) return null;

  const remove = async (s: UserSession) => {
    const ok = await confirm({
      title: `Déconnecter « ${s.device} » ?`,
      message: 'Cet appareil devra se reconnecter avec ton adresse e-mail et ton mot de passe.',
      confirmLabel: 'Déconnecter',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/auth/sessions/${s.id}`);
      await queryClient.invalidateQueries({ queryKey: SESSIONS });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impossible de déconnecter cet appareil.', 'error');
    }
  };

  return (
    <div className="devices">
      <h3>Mes appareils connectés</h3>
      <ul className="device-list">
        {data.map((s) => (
          <li key={s.id}>
            {isPhone(s.device) ? <Smartphone aria-hidden /> : <Monitor aria-hidden />}
            <span className="device-text">
              <span className="device-name">
                {s.device}
                {s.current && <em className="badge"> cet appareil</em>}
              </span>
              <span className="muted small">Dernière activité {formatAgo(s.lastSeen)}</span>
            </span>
            {!s.current && (
              <button type="button" className="icon-btn" aria-label={`Déconnecter ${s.device}`} title="Déconnecter cet appareil" onClick={() => void remove(s)}>
                <Trash2 />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Réglages > Mon compte : nom, mot de passe, appareils connectés, déconnexion. */
export function Account() {
  const user = useUser();
  if (!user) return null;
  return (
    <section className="setting-block" aria-labelledby="account-title">
      <h2 id="account-title">Mon compte</h2>
      <p className="muted">
        Connecté avec <strong>{user.email}</strong>. Tes playlists, tes likes et ton historique sont à toi seul ; la musique, elle, est commune.
      </p>
      <NameForm />
      <PasswordForm />
      <Devices />
      <div className="setting-actions">
        <button type="button" className="btn" onClick={() => void logout()}>
          <LogOut /> Se déconnecter
        </button>
      </div>
    </section>
  );
}
