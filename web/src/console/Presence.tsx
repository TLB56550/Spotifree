import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Music2 } from 'lucide-react';
import type { ConsoleSession } from '@shared/types';
import { api } from '../lib/api';
import { formatAgo, hueOf } from '../lib/format';

export const sessionsQuery = {
  queryKey: ['console', 'sessions'],
  queryFn: () => api.get<ConsoleSession[]>('/api/console/sessions'),
  staleTime: 0,
  refetchInterval: 6000,
} as const;

interface Person {
  userId: number;
  name: string;
  email: string;
  devices: ConsoleSession[];
  lastSeen: number;
  listening: NonNullable<ConsoleSession['listening']> | null;
}

/** Regroupe les appareils en ligne par personne. */
function people(sessions: ConsoleSession[]): Person[] {
  const byUser = new Map<number, Person>();
  for (const s of sessions) {
    if (!s.online) continue;
    const p = byUser.get(s.userId) ?? { userId: s.userId, name: s.userName, email: s.email, devices: [], lastSeen: 0, listening: null };
    p.devices.push(s);
    p.lastSeen = Math.max(p.lastSeen, s.lastSeen);
    if (s.listening && (!p.listening || s.listening.at > p.listening.at)) p.listening = s.listening;
    byUser.set(s.userId, p);
  }
  return [...byUser.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Application Serveur > Vue d'ensemble : qui est connecté en ce moment, sur quel appareil, et ce qu'il a lancé en dernier. */
export function Presence() {
  const { data } = useQuery(sessionsQuery);
  const online = people(data ?? []);
  const devices = online.reduce((n, p) => n + p.devices.length, 0);

  return (
    <section className="c-block" aria-labelledby="presence-title">
      <h2 id="presence-title">
        Connectés en ce moment{data ? ` (${online.length})` : ''}
      </h2>
      {!data ? null : online.length === 0 ? (
        <p className="muted">
          Personne n’est connecté pour le moment. Les personnes qui ont le lecteur ouvert (sur ce PC, un téléphone…) apparaissent ici.
        </p>
      ) : (
        <>
          <ul className="c-people">
            {online.map((p) => (
              <li key={p.userId}>
                <span className="c-avatar" style={{ '--h': hueOf(p.email) } as React.CSSProperties} aria-hidden>
                  {(p.name.trim()[0] ?? '?').toUpperCase()}
                </span>
                <span className="c-person">
                  <span className="c-person-name">
                    {p.name}
                    <span className="c-dot c-dot-sm" aria-label="en ligne" />
                  </span>
                  <span className="muted small">{p.devices.map((d) => d.device).join(' · ')}</span>
                  {p.listening && (
                    <span className="c-listening">
                      <Music2 aria-hidden />
                      <span className="c-listening-text">
                        {p.listening.title} — {p.listening.artist}
                      </span>
                      <span className="muted small">{formatAgo(p.listening.at)}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {devices} appareil{devices > 1 ? 's' : ''} actif{devices > 1 ? 's' : ''} ces 5 dernières minutes. Le titre affiché est le dernier lancé, pas forcément celui qui joue encore.{' '}
            <Link to="/appareils" className="link-btn">
              Tous les appareils
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
