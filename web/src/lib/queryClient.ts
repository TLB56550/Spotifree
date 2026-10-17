import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

/** Recharge tout ce qui dépend du contenu de la bibliothèque. */
export function invalidateLibrary(): void {
  for (const key of ['home', 'tracks', 'albums', 'album', 'artists', 'artist', 'genres', 'genre', 'stats', 'search', 'playlists', 'playlist', 'favorites']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
