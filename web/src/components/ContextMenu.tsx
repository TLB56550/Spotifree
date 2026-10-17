import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { canHover, useIsMobile } from '../hooks/useMobile';
import { useUI, type MenuItem } from '../store/ui';

function MenuList({ items, onClose, depth = 0 }: { items: MenuItem[]; onClose: () => void; depth?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="menu" role="menu" data-depth={depth}>
      {items.map((item, i) => {
        if (item.separator) return <li key={i} className="menu-sep" role="separator" />;
        const hasChildren = Boolean(item.children?.length);
        return (
          <li
            key={i}
            className="menu-li"
            // Au toucher, le survol n'existe pas : le sous-menu s'ouvre au toucher, sans clignoter.
            onMouseEnter={() => canHover() && setOpen(hasChildren ? i : null)}
          >
            <button
              type="button"
              role="menuitem"
              className={`menu-item ${item.danger ? 'is-danger' : ''}`}
              disabled={item.disabled}
              aria-haspopup={hasChildren || undefined}
              aria-expanded={hasChildren ? open === i : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) {
                  setOpen(open === i ? null : i);
                  return;
                }
                onClose();
                item.onClick?.();
              }}
            >
              <span className="menu-icon">{item.icon}</span>
              <span className="menu-label">{item.label}</span>
              {hasChildren && <ChevronRight className="menu-chevron" />}
            </button>
            {hasChildren && open === i && (
              <div className="menu-sub">
                <MenuList items={item.children!} onClose={onClose} depth={depth + 1} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ContextMenuHost() {
  const menu = useUI((s) => s.menu);
  const close = useUI((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(menu.y, window.innerHeight - height - margin)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    if (mobile) {
      // Feuille du bas : se ferme en touchant à côté. Pas de fermeture sur « resize » (la barre d'adresse du téléphone la déclenche).
      return () => window.removeEventListener('keydown', onKey);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, close, mobile]);

  if (!menu) return null;
  if (mobile) {
    return (
      <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => e.preventDefault()}>
        <div className="sheet" role="dialog" aria-label="Options">
          <div className="sheet-grip" aria-hidden />
          <MenuList items={menu.items} onClose={close} />
        </div>
      </div>
    );
  }
  const flip = (pos?.left ?? menu.x) > window.innerWidth - 480;
  return (
    <div
      ref={ref}
      className={`menu-host ${flip ? 'flip' : ''}`}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={menu.items} onClose={close} />
    </div>
  );
}
