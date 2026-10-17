import { NavLink } from 'react-router-dom';
import { useIsMobile } from '../hooks/useMobile';

const SECTIONS: [string, string][] = [
  ['/library', 'Playlists'],
  ['/albums', 'Albums'],
  ['/artists', 'Artistes'],
  ['/songs', 'Titres'],
];

/** Sur téléphone, les quatre vues de la bibliothèque se choisissent avec ces pastilles. */
export function LibraryChips() {
  const mobile = useIsMobile();
  if (!mobile) return null;
  return (
    <nav className="chips" aria-label="Sections de la bibliothèque">
      {SECTIONS.map(([to, label]) => (
        <NavLink key={to} to={to} end className={({ isActive }) => `chip ${isActive ? 'is-active' : ''}`}>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
