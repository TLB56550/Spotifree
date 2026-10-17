import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../store/player';
import { useLikes } from '../store/likes';
import { useUI } from '../store/ui';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function useShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.metaKey) return;
      // Espace sur un bouton ou un lien : on laisse le navigateur l'activer.
      const onControl = (e.target as HTMLElement | null)?.closest('button, a, [role="slider"], [role="menuitem"]');
      const p = usePlayer.getState();
      switch (e.key) {
        case ' ':
          if (onControl) return;
          e.preventDefault();
          p.toggle();
          break;
        case 'ArrowRight':
          if ((e.target as HTMLElement | null)?.getAttribute('role') === 'slider') return;
          e.preventDefault();
          if (e.ctrlKey) p.next();
          else p.seekBy(5);
          break;
        case 'ArrowLeft':
          if ((e.target as HTMLElement | null)?.getAttribute('role') === 'slider') return;
          e.preventDefault();
          if (e.ctrlKey) p.prev();
          else p.seekBy(-5);
          break;
        case 'ArrowUp':
          if (onControl?.getAttribute('role') === 'slider') return;
          e.preventDefault();
          p.setVolume(p.volume + 0.05);
          break;
        case 'ArrowDown':
          if (onControl?.getAttribute('role') === 'slider') return;
          e.preventDefault();
          p.setVolume(p.volume - 0.05);
          break;
        case 'm':
        case 'M':
          p.toggleMute();
          break;
        case 's':
        case 'S':
          if (!e.ctrlKey) p.toggleShuffle();
          break;
        case 'r':
        case 'R':
          if (!e.ctrlKey) p.cycleRepeat();
          break;
        case 'l':
        case 'L':
          if (p.current && !e.ctrlKey) void useLikes.getState().toggle(p.current.id);
          break;
        case 'q':
        case 'Q':
          if (!e.ctrlKey) useUI.getState().toggleQueue();
          break;
        case '/':
          e.preventDefault();
          navigate('/search');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
