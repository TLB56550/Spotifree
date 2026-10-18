import { NavLink, Route, Routes } from 'react-router-dom';
import { LayoutDashboard, Music2, ServerCog, Smartphone, Users } from 'lucide-react';
import { ModalHost, ToastHost } from '../components/Modals';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { UpdateGate } from '../components/UpdateGate';
import { Accounts } from './Accounts';
import { Devices } from './Devices';
import { useConsoleInfo } from './Folders';
import { MusicPage } from './MusicPage';
import { Overview } from './Overview';
import { RemoteAccess } from './RemoteAccess';
import { ServerSection } from './ServerSection';
import { DropHint, UploadPill } from './Uploads';
import { shutdownServer, useServerState } from './state';

function Vinyl() {
  return <img src="/icons/logo-serveur.png" className="brand-mark c-mark" alt="" width="30" height="30" />;
}

const NAV = [
  { to: '/', label: 'Vue d’ensemble', icon: LayoutDashboard, end: true },
  { to: '/comptes', label: 'Comptes', icon: Users, end: false },
  { to: '/appareils', label: 'Appareils', icon: Smartphone, end: false },
  { to: '/musique', label: 'Musique', icon: Music2, end: false },
  { to: '/serveur', label: 'Serveur', icon: ServerCog, end: false },
];

function Page({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="c-page">
      <header className="c-head">
        <div>
          <h1>{title}</h1>
          {intro && <p className="muted">{intro}</p>}
        </div>
      </header>
      {children}
    </div>
  );
}

function Stopped() {
  return (
    <div className="c-stopped">
      <Vinyl />
      <h1>Le serveur est arrêté</h1>
      <p className="muted">Tu peux fermer cette fenêtre. Pour le relancer, ouvre « Spotifree Serveur » ou « Spotifree » (raccourcis du bureau).</p>
    </div>
  );
}

export default function ConsoleApp() {
  const stopped = useServerState((s) => s.stopped);
  const { data: info } = useConsoleInfo();
  if (stopped) return <Stopped />;

  return (
    <div className="c-app">
      <UpdateGate statusUrl="/api/console/update" />
      <aside className="panel c-rail">
        <div className="c-brand">
          <Vinyl />
          <div>
            <span className="brand-name">Spotifree</span>
            <span className="c-brand-sub">Serveur</span>
          </div>
        </div>
        <nav className="nav" aria-label="Navigation du serveur">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="c-rail-foot">
          <UploadPill />
          {info && <span className="muted small">Version {info.version}</span>}
        </div>
      </aside>
      <main className="panel c-main">
        <ConnectionBanner />
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route
            path="/comptes"
            element={
              <Page title="Comptes" intro="Les personnes qui peuvent se connecter au lecteur.">
                <Accounts />
              </Page>
            }
          />
          <Route
            path="/appareils"
            element={
              <Page title="Appareils" intro="Brancher un téléphone ou un autre ordinateur au serveur, et voir ce qui y est connecté.">
                <RemoteAccess />
                <Devices />
              </Page>
            }
          />
          <Route path="/musique" element={<MusicPage />} />
          <Route
            path="/serveur"
            element={
              <Page title="Serveur">
                <ServerSection onShutdown={() => void shutdownServer()} />
              </Page>
            }
          />
          <Route path="*" element={<Overview />} />
        </Routes>
      </main>
      <DropHint />
      <ModalHost />
      <ToastHost />
    </div>
  );
}
