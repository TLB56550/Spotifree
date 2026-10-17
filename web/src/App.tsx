import { useEffect, useRef } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ScanStatus } from '@shared/types';
import { api } from './lib/api';
import { invalidateLibrary, queryClient } from './lib/queryClient';
import { ScrollContext } from './hooks/scroll';
import { useShortcuts } from './hooks/useShortcuts';
import { useIsMobile } from './hooks/useMobile';
import { useLikes } from './store/likes';
import { usePlayer } from './store/player';
import { useUI } from './store/ui';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { PlayerBar } from './components/PlayerBar';
import { QueuePanel } from './components/QueuePanel';
import { ContextMenuHost } from './components/ContextMenu';
import { ModalHost, ToastHost } from './components/Modals';
import { PageMessage } from './components/Hero';
import { ConnectionBanner } from './components/ConnectionBanner';
import { UpdateGate } from './components/UpdateGate';
import { UploadBanner, UploadFloat } from './components/Uploads';
import { MiniPlayer, NowPlaying, TabBar } from './components/Mobile';
import HomePage from './pages/Home';
import SearchPage from './pages/Search';
import AlbumPage from './pages/Album';
import ArtistPage from './pages/Artist';
import PlaylistPage from './pages/Playlist';
import SettingsPage from './pages/Settings';
import { AlbumsPage, ArtistsPage, GenrePage, LibraryPage, LikedPage, SongsPage } from './pages/Library';

/** Recharge les pages pendant une analyse, puis une dernière fois quand elle se termine. */
function useScanWatcher(): void {
  const { data } = useQuery({
    queryKey: ['scan'],
    queryFn: () => api.get<ScanStatus>('/api/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 8000),
  });
  const wasRunning = useRef(false);
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    if (data.running) {
      if (now - lastRefresh.current > 4000) {
        lastRefresh.current = now;
        void invalidateLibrary();
      }
    } else if (wasRunning.current) {
      void invalidateLibrary();
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
    }
    wasRunning.current = data.running;
  }, [data]);
}

const routes = (
  <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/search" element={<SearchPage />} />
    <Route path="/library" element={<LibraryPage />} />
    <Route path="/songs" element={<SongsPage />} />
    <Route path="/albums" element={<AlbumsPage />} />
    <Route path="/artists" element={<ArtistsPage />} />
    <Route path="/album/:id" element={<AlbumPage />} />
    <Route path="/artist/:id" element={<ArtistPage />} />
    <Route path="/playlist/:id" element={<PlaylistPage />} />
    <Route path="/liked" element={<LikedPage />} />
    <Route path="/genre/:name" element={<GenrePage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route
      path="*"
      element={
        <PageMessage title="Page introuvable">
          <Link to="/">Retour à l’accueil</Link>
        </PageMessage>
      }
    />
  </Routes>
);

export default function App() {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const queueOpen = useUI((s) => s.queueOpen);
  const mobile = useIsMobile();

  useShortcuts();
  useScanWatcher();

  useEffect(() => {
    void usePlayer.getState().restore();
    void useLikes.getState().load();
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Les styles propres au tactile s'appuient sur cette classe.
  useEffect(() => {
    document.documentElement.classList.toggle('is-mobile', mobile);
  }, [mobile]);

  return (
    <ScrollContext.Provider value={mainRef}>
      <UpdateGate />
      {mobile ? (
        <div className="m-app">
          <main className="m-main" ref={mainRef}>
            <TopBar />
            <div className="page">{routes}</div>
          </main>
          <div className="m-dock">
            <ConnectionBanner />
            <UploadBanner />
            <MiniPlayer />
            <TabBar />
          </div>
          <NowPlaying />
          <ContextMenuHost />
          <ModalHost />
          <ToastHost />
        </div>
      ) : (
        <div className={`app ${queueOpen ? 'with-queue' : ''}`}>
          <Sidebar />
          <main className="panel main" ref={mainRef}>
            <TopBar />
            <div className="page">{routes}</div>
          </main>
          {queueOpen && <QueuePanel />}
          <PlayerBar />
          <UploadFloat />
          <ContextMenuHost />
          <ModalHost />
          <ToastHost />
        </div>
      )}
    </ScrollContext.Provider>
  );
}
