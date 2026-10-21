"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderArtistFavorite, ProviderArtistSummary } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

export function useFavoriteArtists(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["favorite-artists", userId ?? "anonymous"];

  const query = useQuery<ProviderArtistFavorite[]>({
    queryKey,
    queryFn: () => musicRoomApi.listFavoriteArtists(),
    enabled: Boolean(userId),
    staleTime: 60 * 1000
  });

  const saveMutation = useMutation({
    mutationFn: (artist: ProviderArtistSummary) => musicRoomApi.saveFavoriteArtist(artist),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: ({ provider, providerArtistId }: { provider: ProviderArtistFavorite["provider"]; providerArtistId: string }) =>
      musicRoomApi.deleteFavoriteArtist(provider as "netease" | "qqmusic", providerArtistId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  return {
    ...query,
    artists: query.data ?? [],
    saveFavoriteArtist: saveMutation.mutateAsync,
    deleteFavoriteArtist: deleteMutation.mutateAsync,
    isMutating: saveMutation.isPending || deleteMutation.isPending
  };
}
