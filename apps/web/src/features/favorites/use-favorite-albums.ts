"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderAlbumFavorite } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

export function useFavoriteAlbums(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["favorite-albums", userId ?? "anonymous"];

  const query = useQuery<ProviderAlbumFavorite[]>({
    queryKey,
    queryFn: () => musicRoomApi.listFavoriteAlbums(),
    enabled: Boolean(userId),
    staleTime: 60 * 1000
  });

  const saveMutation = useMutation({
    mutationFn: (album: Omit<ProviderAlbumFavorite, "id" | "createdAt" | "updatedAt">) =>
      musicRoomApi.saveFavoriteAlbum(album),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: ({ provider, providerAlbumId }: { provider: ProviderAlbumFavorite["provider"]; providerAlbumId: string }) =>
      musicRoomApi.deleteFavoriteAlbum(provider as "netease" | "qqmusic", providerAlbumId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  return {
    ...query,
    albums: query.data ?? [],
    saveFavoriteAlbum: saveMutation.mutateAsync,
    deleteFavoriteAlbum: deleteMutation.mutateAsync,
    isMutating: saveMutation.isPending || deleteMutation.isPending
  };
}
