import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Settings, X } from 'lucide-react';
import type { ScanStatus } from '@shared/types';
import { api } from '../lib/api';
import { useScrollParent } from '../hooks/scroll';
import { useIsMobile } from '../hooks/useMobile';

function SearchBox() {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile();

  // Sur téléphone, on ne fait pas surgir le clavier tout seul.
  useEffect(() => {
    if (!mobile) ref.current?.focus();
  }, [mobile]);

  // Une recherche lancée depuis ailleurs (lien, retour arrière) met le champ à jour.
  useEffect(() => {
    setValue(params.get('q') ?? '');
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => {
      const current = params.get('q') ?? '';
      if (value === current) return;
      setParams(value ? { q: value } : {}, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [value, params, setParams]);

  return (
    <div className="search-box">
      <Search aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder="Que veux-tu écouter ?"
        aria-label="Rechercher un titre, un album, un artiste ou une playlist"
        onChange={(e) => setValue(e.target.value)}
      />
      {value && (
        <button type="button" className="icon-btn" aria-label="Effacer la recherche" onClick={() => setValue('')}>
          <X />
        </button>
      )}
    </div>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useScrollParent();
  const mobile = useIsMobile();
  const [scrolled, setScrolled] = useState(false);
  const atRoot = ['/', '/search', '/library', '/albums', '/artists', '/songs'].includes(location.pathname);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 60);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, location.pathname]);

  const { data: scan } = useQuery({
    queryKey: ['scan'],
    queryFn: () => api.get<ScanStatus>('/api/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 8000),
  });

  return (
    <header className={`topbar ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="topbar-nav">
        {(!mobile || !atRoot) && (
          <button type="button" className="icon-btn round" aria-label="Page précédente" onClick={() => navigate(-1)}>
            <ChevronLeft />
          </button>
        )}
        {!mobile && (
          <button type="button" className="icon-btn round" aria-label="Page suivante" onClick={() => navigate(1)}>
            <ChevronRight />
          </button>
        )}
      </div>
      {location.pathname === '/search' && <SearchBox />}
      <div className="topbar-spacer" />
      {scan?.running && (
        <Link to="/settings" className="scan-pill" title="Analyse de la musique en cours">
          <RefreshCw className="spin" />
          <span>
            Analyse… {scan.total > 0 ? `${Math.min(100, Math.round((scan.done / scan.total) * 100))} %` : ''}
          </span>
        </Link>
      )}
      {mobile && location.pathname !== '/settings' && (
        <Link to="/settings" className="icon-btn round" aria-label="Paramètres">
          <Settings />
        </Link>
      )}
    </header>
  );
}
