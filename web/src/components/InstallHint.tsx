import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { isNativeApp } from '../lib/native';
import { useAbout } from '../lib/about';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome envoie cet évènement très tôt : on le garde pour le moment où le bandeau s'affiche.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const FLAG = 'mb.installHintHidden';
const readHidden = (): boolean => {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
};

const isStandalone = (): boolean =>
  (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;

/** Invite à ajouter l'application à l'écran d'accueil du téléphone. */
export function InstallHint() {
  const { data: about } = useAbout();
  const [, bump] = useState(0);
  const [hidden, setHidden] = useState(readHidden);

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (!about || about.local || hidden || isStandalone() || isNativeApp()) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(FLAG, '1');
    } catch {
      // Stockage indisponible : le bandeau reviendra à la prochaine visite.
    }
  };

  return (
    <aside className="install-hint" aria-label="Installer l’application">
      <Smartphone aria-hidden />
      <div className="install-text">
        <strong>Installe l’application</strong>
        <p>
          {deferred
            ? 'Ajoute Spotifree à ton écran d’accueil pour l’ouvrir comme une vraie application.'
            : 'Dans le menu ⋮ de Chrome, choisis « Ajouter à l’écran d’accueil » (ou « Installer l’application »).'}
        </p>
        {deferred && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const prompt = deferred;
              if (!prompt) return;
              void prompt.prompt().then(() => prompt.userChoice).then((choice) => {
                deferred = null;
                if (choice.outcome === 'accepted') hide();
                else bump((n) => n + 1);
              });
            }}
          >
            Installer
          </button>
        )}
      </div>
      <button type="button" className="icon-btn" aria-label="Masquer ce message" onClick={hide}>
        <X />
      </button>
    </aside>
  );
}
