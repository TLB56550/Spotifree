import { useQuery } from '@tanstack/react-query';
import type { AppInfo } from '@shared/types';
import { api } from './api';

export const aboutQuery = { queryKey: ['about'], queryFn: () => api.get<AppInfo>('/api/about'), staleTime: 60_000 } as const;

/** Version du serveur, et si ce lecteur est ouvert sur le PC du serveur. */
export function useAbout() {
  return useQuery(aboutQuery);
}
