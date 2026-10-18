import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import type { AdminUser, AdminUsers as AdminUsersData } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { formatAgo } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

const KEY = ['console', 'users'];
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

interface Handout {
  title: string;
  email: string;
  password: string;
}

/** Mot de passe provisoire : affiché une seule fois, à transmettre à la personne. */
function HandoutCard({ handout, onClose }: { handout: Handout; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handout.password);
      toast('Mot de passe copié');
    } catch {
      toast('Copie impossible : recopie-le à la main.', 'error');
    }
  };
  return (
    <div className="callout" role="status">
      <strong>{handout.title}</strong>
      <p>
        Adresse : <code>{handout.email}</code>
        <br />
        Mot de passe provisoire : <code className="temp-pw">{handout.password}</code>
      </p>
      <p className="muted small">Note-le maintenant : il ne sera plus affiché. À sa prochaine connexion, la personne devra choisir son propre mot de passe.</p>
      <div className="setting-actions">
        <button type="button" className="btn" onClick={() => void copy()}>
          <Copy /> Copier le mot de passe
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          J’ai noté, fermer
        </button>
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (h: Handout) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post<AdminUsersData>('/api/console/users', { email, name, password });
      queryClient.setQueryData(KEY, res);
      onCreated({ title: 'Compte créé', email: email.trim().toLowerCase(), password });
      setEmail('');
      setName('');
      setPassword('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="setting-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPassword(randomPassword());
            setOpen(true);
          }}
        >
          <UserPlus /> Créer un compte
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form create-user" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Adresse e-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus maxLength={254} />
      </label>
      <label className="field">
        <span>Prénom ou pseudo</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <label className="field">
        <span>Mot de passe provisoire</span>
        <span className="pw-wrap">
          <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={200} autoComplete="off" spellCheck={false} />
          <button type="button" className="btn btn-ghost" onClick={() => setPassword(randomPassword())}>
            Générer
          </button>
        </span>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="setting-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !email || password.length < 8}>
          Créer le compte
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function UserRow({ user, onHandout }: { user: AdminUser; onHandout: (h: Handout) => void }) {
  const confirm = useUI((s) => s.confirm);

  const run = async (action: () => Promise<AdminUsersData & { password?: string }>, done?: string) => {
    try {
      const res = await action();
      queryClient.setQueryData(KEY, { users: res.users, signupOpen: res.signupOpen, legacy: res.legacy });
      void queryClient.invalidateQueries({ queryKey: ['console', 'sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['console', 'stats'] });
      if (done) toast(done);
      return res;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Action impossible.', 'error');
      return null;
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: `Réinitialiser le mot de passe de ${user.name} ?`,
      message: 'Un mot de passe provisoire sera créé et affiché une seule fois. Ses appareils seront déconnectés.',
      confirmLabel: 'Réinitialiser',
      danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.post(`/api/console/users/${user.id}/reset`));
    if (res?.password) onHandout({ title: `Nouveau mot de passe pour ${user.name}`, email: user.email, password: res.password });
  };

  const toggleDisabled = async () => {
    if (!user.disabled) {
      const ok = await confirm({
        title: `Désactiver le compte de ${user.name} ?`,
        message: 'Il sera déconnecté et ne pourra plus se connecter. Ses playlists sont conservées ; tu pourras le réactiver.',
        confirmLabel: 'Désactiver',
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.patch(`/api/console/users/${user.id}`, { disabled: !user.disabled }), user.disabled ? 'Compte réactivé' : 'Compte désactivé');
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer le compte de ${user.name} ?`,
      message: 'Ses playlists, ses likes et son historique seront supprimés définitivement. La musique n’est pas touchée.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await run(() => api.del(`/api/console/users/${user.id}`), 'Compte supprimé');
  };

  return (
    <li className={`user-row ${user.disabled ? 'is-disabled' : ''}`}>
      <span className="user-avatar" aria-hidden>
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="user-main">
        <div className="user-name">
          <strong>{user.name}</strong>
          {user.disabled && <em className="badge badge-warn">désactivé</em>}
          {user.mustChange && <em className="badge">mot de passe provisoire</em>}
        </div>
        <span className="muted small">{user.email}</span>
        <span className="muted small">
          {user.lastSeen ? `Dernière connexion ${formatAgo(user.lastSeen)}` : 'Jamais connecté'} · {user.playlistCount} playlist{user.playlistCount > 1 ? 's' : ''} · {user.sessionCount} appareil
          {user.sessionCount > 1 ? 's' : ''}
        </span>
      </div>
      <div className="user-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void reset()} title="Mot de passe oublié">
          <KeyRound /> Mot de passe
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void toggleDisabled()}>
          {user.disabled ? <UserCheck /> : <UserX />} {user.disabled ? 'Réactiver' : 'Désactiver'}
        </button>
        <button type="button" className="icon-btn" aria-label={`Supprimer le compte de ${user.name}`} title="Supprimer le compte" onClick={() => void remove()}>
          <Trash2 />
        </button>
      </div>
    </li>
  );
}

/** Playlists et likes d'avant les comptes : à confier à un compte. */
function LegacyCallout({ data }: { data: AdminUsersData }) {
  const confirm = useUI((s) => s.confirm);
  const { playlists, favorites } = data.legacy;
  if (!playlists && !favorites) return null;
  const give = async (u: AdminUser) => {
    const ok = await confirm({
      title: `Donner ces données à ${u.name} ?`,
      message: 'Les playlists et les titres likés d’avant les comptes deviendront les siens. Cela ne se défait pas.',
      confirmLabel: `Donner à ${u.name}`,
    });
    if (!ok) return;
    try {
      queryClient.setQueryData(KEY, await api.post<AdminUsersData>(`/api/console/users/${u.id}/adopt`));
      toast(`Les données d’avant les comptes sont maintenant celles de ${u.name}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Action impossible.', 'error');
    }
  };
  return (
    <div className="callout" role="status">
      <strong>Des données d’avant les comptes n’appartiennent à personne</strong>
      <p>
        {playlists} playlist{playlists > 1 ? 's' : ''} et {favorites} titre{favorites > 1 ? 's' : ''} liké{favorites > 1 ? 's' : ''}. Choisis le compte qui les reprend (le plus souvent le tien).
      </p>
      {data.users.length === 0 ? (
        <p className="muted small">Crée d’abord un compte, ou ouvre le lecteur sur ce PC et crée le premier compte : il les reprendra tout seul.</p>
      ) : (
        <div className="setting-actions">
          {data.users.map((u) => (
            <button key={u.id} type="button" className="btn" onClick={() => void give(u)}>
              Donner à {u.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Application Serveur > Comptes : inscriptions, création, mot de passe oublié, désactivation, suppression. */
export function Accounts() {
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.get<AdminUsersData>('/api/console/users'), staleTime: 0, refetchInterval: 8000 });
  const [handout, setHandout] = useState<Handout | null>(null);
  const [busy, setBusy] = useState(false);

  const setSignup = async (open: boolean) => {
    setBusy(true);
    try {
      queryClient.setQueryData(KEY, await api.put<AdminUsersData>('/api/console/signup', { open }));
      toast(open ? 'Inscriptions ouvertes' : 'Inscriptions fermées');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Impossible de changer ce réglage.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;

  return (
    <>
      <section className="setting-block" aria-labelledby="signup-title">
        <h2 id="signup-title">Inscriptions</h2>
        <p className="muted">
          Chaque personne se connecte avec son adresse e-mail et son mot de passe depuis le lecteur, et garde ses propres playlists, likes et historique. La musique est commune.
        </p>
        <div className="switch-row">
          <div>
            <strong>Inscriptions ouvertes</strong>
            <span className="muted small">Toute personne qui peut ouvrir l’adresse du serveur peut créer son compte. Ferme-les une fois ton entourage inscrit.</span>
          </div>
          <button type="button" role="switch" aria-checked={data.signupOpen} aria-label="Inscriptions ouvertes" className={`switch ${data.signupOpen ? 'is-on' : ''}`} disabled={busy} onClick={() => void setSignup(!data.signupOpen)}>
            <span />
          </button>
        </div>
      </section>

      <section className="setting-block" aria-labelledby="users-title">
        <h2 id="users-title">Comptes{data.users.length ? ` (${data.users.length})` : ''}</h2>
        <LegacyCallout data={data} />
        {handout && <HandoutCard handout={handout} onClose={() => setHandout(null)} />}
        {data.users.length === 0 ? (
          <p className="muted">Aucun compte pour le moment. La première personne qui ouvre le lecteur crée le sien.</p>
        ) : (
          <ul className="user-list">
            {data.users.map((u) => (
              <UserRow key={u.id} user={u} onHandout={setHandout} />
            ))}
          </ul>
        )}
        <CreateForm onCreated={setHandout} />
      </section>
    </>
  );
}
