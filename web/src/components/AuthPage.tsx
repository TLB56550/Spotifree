import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import type { AuthState } from '@shared/types';
import { api, ApiError, AUTH_LOST_EVENT } from '../lib/api';
import { logout, restartApp, useAuth } from '../lib/auth';
import { changeNativeServer, isNativeApp } from '../lib/native';
import { audio } from '../store/player';

/** Disque noir, sillons, étiquette dorée : le même repère visuel que dans la barre latérale. */
function Vinyl({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <circle cx="100" cy="100" r="96" fill="#0c0e12" stroke="currentColor" strokeWidth="2" />
      {[84, 74, 64, 54, 44].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="0.8" opacity=".22" />
      ))}
      <circle cx="100" cy="100" r="31" fill="var(--accent)" />
      <circle cx="100" cy="100" r="5" fill="#0c0e12" />
    </svg>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-art">
        <Vinyl className="auth-vinyl" />
        <p className="auth-brand">Spotifree</p>
        <p className="auth-tagline">Ta musique, à portée de tous ceux que tu invites.</p>
      </div>
      <main className="auth-card">{children}</main>
    </div>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="pw-wrap">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          maxLength={200}
        />
        <button type="button" className="icon-btn" aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </span>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { email, password });
      restartApp();
    } catch (err) {
      setError(errorText(err, 'Connexion impossible.'));
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Adresse e-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required maxLength={254} />
      </label>
      <PasswordField label="Mot de passe" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !email || !password}>
        {busy && <Loader2 className="spin" />} Se connecter
      </button>
      <p className="muted small">Mot de passe oublié ? Demande à la personne qui gère le serveur de le réinitialiser.</p>
    </form>
  );
}

function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/register', { name, email, password });
      restartApp();
    } catch (err) {
      setError(errorText(err, 'Création du compte impossible.'));
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Prénom ou pseudo</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={60} autoFocus />
      </label>
      <label className="field">
        <span>Adresse e-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required maxLength={254} />
      </label>
      <PasswordField label="Mot de passe" value={password} onChange={setPassword} autoComplete="new-password" hint="8 caractères minimum. Aucun e-mail n’est envoyé : si tu l’oublies, la personne qui gère le serveur peut le réinitialiser." />
      <PasswordField label="Confirme le mot de passe" value={again} onChange={setAgain} autoComplete="new-password" />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || !email || !password || !again}>
        {busy && <Loader2 className="spin" />} Créer mon compte
      </button>
    </form>
  );
}

function ServerLink() {
  if (!isNativeApp()) return null;
  return (
    <button type="button" className="link-btn auth-server" onClick={changeNativeServer}>
      Changer l’adresse du serveur
    </button>
  );
}

function AuthPage({ state }: { state: AuthState }) {
  const [tab, setTab] = useState<'in' | 'up'>('in');

  if (!state.hasUsers) {
    return (
      <Frame>
        <h1>Bienvenue</h1>
        <p className="muted">
          Personne n’a encore de compte. Crée le premier : si tu utilises ce PC pour le serveur, il reprend tes playlists et tes likes d’avant les comptes.
        </p>
        <SignUp />
      </Frame>
    );
  }

  const signup = state.signupOpen;
  return (
    <Frame>
      <h1>{tab === 'in' || !signup ? 'Content de te revoir' : 'Crée ton compte'}</h1>
      {signup ? (
        <div className="auth-tabs" role="tablist" aria-label="Connexion ou inscription">
          <button type="button" role="tab" aria-selected={tab === 'in'} className={tab === 'in' ? 'is-active' : ''} onClick={() => setTab('in')}>
            Connexion
          </button>
          <button type="button" role="tab" aria-selected={tab === 'up'} className={tab === 'up' ? 'is-active' : ''} onClick={() => setTab('up')}>
            Créer un compte
          </button>
        </div>
      ) : (
        <p className="muted">Les inscriptions sont fermées : demande un compte à la personne qui gère le serveur.</p>
      )}
      {tab === 'in' || !signup ? <SignIn /> : <SignUp />}
      <ServerLink />
    </Frame>
  );
}

/** Mot de passe provisoire donné depuis l'application Serveur : à remplacer avant d'aller plus loin. */
function ForcePassword({ name }: { name: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/password', { current, next });
      restartApp();
    } catch (err) {
      setError(errorText(err, 'Changement impossible.'));
      setBusy(false);
    }
  };

  return (
    <Frame>
      <h1>Choisis ton mot de passe</h1>
      <p className="muted">
        {name}, un mot de passe provisoire t’a été donné. Remplace-le par le tien pour continuer.
      </p>
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        <PasswordField label="Mot de passe provisoire" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        <PasswordField label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" hint="8 caractères minimum." />
        <PasswordField label="Confirme le nouveau mot de passe" value={again} onChange={setAgain} autoComplete="new-password" />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !current || !next || !again}>
          {busy && <Loader2 className="spin" />} Enregistrer
        </button>
        <button type="button" className="link-btn" onClick={() => void logout()}>
          Se déconnecter
        </button>
      </form>
    </Frame>
  );
}

/** Affiche l'application seulement à une personne connectée ; sinon l'écran de connexion. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isError, isLoading, refetch } = useAuth();

  useEffect(() => {
    const again = () => void refetch();
    window.addEventListener(AUTH_LOST_EVENT, again);
    return () => window.removeEventListener(AUTH_LOST_EVENT, again);
  }, [refetch]);

  // Plus personne de connecté (session retirée depuis l'application Serveur…) : la musique s'arrête.
  const signedOut = Boolean(data) && !data!.user;
  useEffect(() => {
    if (signedOut) audio.pause();
  }, [signedOut]);

  if (isLoading) {
    return (
      <div className="auth-splash" role="status" aria-label="Chargement">
        <Vinyl className="auth-vinyl is-small" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Frame>
        <h1>Serveur injoignable</h1>
        <p className="muted">Vérifie que le serveur est allumé et que tu es bien connecté au réseau, puis réessaie.</p>
        <button type="button" className="btn" onClick={() => void refetch()}>
          Réessayer
        </button>
        <ServerLink />
      </Frame>
    );
  }
  if (!data.user) return <AuthPage state={data} />;
  if (data.user.mustChange) return <ForcePassword name={data.user.name} />;
  return <>{children}</>;
}
