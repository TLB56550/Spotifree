import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, Shield, ShieldOff, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import type { AdminUser, AdminUsers as AdminUsersData } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useUser } from '../lib/auth';
import { formatAgo } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

const KEY = ['admin-users'];
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
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post<AdminUsersData>('/api/admin/users', { email, name, password, isAdmin: admin });
      queryClient.setQueryData(KEY, res);
      onCreated({ title: 'Compte créé', email: email.trim().toLowerCase(), password });
      setEmail('');
      setName('');
      setPassword('');
      setAdmin(false);
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
      <label className="check-row tight">
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        <span>Administrateur (gère la musique, les comptes et le serveur)</span>
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

function UserRow({ user, self, onHandout }: { user: AdminUser; self: boolean; onHandout: (h: Handout) => void }) {
  const confirm = useUI((s) => s.confirm);

  const run = async (action: () => Promise<AdminUsersData & { password?: string }>, done?: string) => {
    try {
      const res = await action();
      queryClient.setQueryData(KEY, { users: res.users, signupOpen: res.signupOpen });
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
    const res = await run(() => api.post(`/api/admin/users/${user.id}/reset`));
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
    await run(() => api.patch(`/api/admin/users/${user.id}`, { disabled: !user.disabled }), user.disabled ? 'Compte réactivé' : 'Compte désactivé');
  };

  const toggleAdmin = async () => {
    const ok = await confirm({
      title: user.isAdmin ? `Retirer les droits d’administrateur à ${user.name} ?` : `Rendre ${user.name} administrateur ?`,
      message: user.isAdmin
        ? 'Il ne pourra plus gérer la musique, les comptes ni le serveur.'
        : 'Il pourra gérer la musique, les comptes et le serveur, comme toi.',
      confirmLabel: user.isAdmin ? 'Retirer les droits' : 'Rendre administrateur',
      danger: user.isAdmin,
    });
    if (!ok) return;
    await run(() => api.patch(`/api/admin/users/${user.id}`, { isAdmin: !user.isAdmin }), user.isAdmin ? 'Droits retirés' : 'Nouvel administrateur');
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer le compte de ${user.name} ?`,
      message: 'Ses playlists, ses likes et son historique seront supprimés définitivement. La musique n’est pas touchée.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await run(() => api.del(`/api/admin/users/${user.id}`), 'Compte supprimé');
  };

  return (
    <li className={`user-row ${user.disabled ? 'is-disabled' : ''}`}>
      <span className="user-avatar" aria-hidden>
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="user-main">
        <div className="user-name">
          <strong>{user.name}</strong>
          {self && <em className="badge">toi</em>}
          {user.isAdmin && <em className="badge badge-accent">administrateur</em>}
          {user.disabled && <em className="badge badge-warn">désactivé</em>}
          {user.mustChange && <em className="badge">mot de passe provisoire</em>}
        </div>
        <span className="muted small">{user.email}</span>
        <span className="muted small">
          {user.lastSeen ? `Dernière connexion ${formatAgo(user.lastSeen)}` : 'Jamais connecté'} · {user.playlistCount} playlist{user.playlistCount > 1 ? 's' : ''} · {user.sessionCount} appareil
          {user.sessionCount > 1 ? 's' : ''}
        </span>
      </div>
      {!self && (
        <div className="user-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void reset()} title="Mot de passe oublié">
            <KeyRound /> Mot de passe
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void toggleAdmin()}>
            {user.isAdmin ? <ShieldOff /> : <Shield />} {user.isAdmin ? 'Retirer admin' : 'Rendre admin'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void toggleDisabled()}>
            {user.disabled ? <UserCheck /> : <UserX />} {user.disabled ? 'Réactiver' : 'Désactiver'}
          </button>
          <button type="button" className="icon-btn" aria-label={`Supprimer le compte de ${user.name}`} title="Supprimer le compte" onClick={() => void remove()}>
            <Trash2 />
          </button>
        </div>
      )}
    </li>
  );
}

/** Administration > Comptes : inscriptions, création, mot de passe oublié, droits, suppression. */
export function AdminUsers() {
  const me = useUser();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.get<AdminUsersData>('/api/admin/users'), staleTime: 0 });
  const [handout, setHandout] = useState<Handout | null>(null);
  const [busy, setBusy] = useState(false);

  const setSignup = async (open: boolean) => {
    setBusy(true);
    try {
      queryClient.setQueryData(KEY, await api.put<AdminUsersData>('/api/admin/signup', { open }));
      void queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast(open ? 'Inscriptions ouvertes' : 'Inscriptions fermées');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Impossible de changer ce réglage.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;

  return (
    <section className="setting-block" aria-labelledby="users-title">
      <h2 id="users-title">Comptes</h2>
      <p className="muted">
        Chaque personne se connecte avec son adresse e-mail et son mot de passe, et garde ses propres playlists, likes et historique. La musique est commune ; seuls les administrateurs la gèrent.
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

      {handout && <HandoutCard handout={handout} onClose={() => setHandout(null)} />}

      <ul className="user-list">
        {data.users.map((u) => (
          <UserRow key={u.id} user={u} self={u.id === me?.id} onHandout={setHandout} />
        ))}
      </ul>

      <CreateForm onCreated={setHandout} />
    </section>
  );
}
