"use client";

import { PlaylistsWorkspacePage } from "@/components/PlaylistsWorkspacePage";

/**
 * The profile page embeds the same local-playlist workspace used by the
 * dedicated route, so playlist management stays in one place.
 */
export function LocalPlaylistsOverview() {
  return (
    <div data-testid="local-playlists-overview">
      <PlaylistsWorkspacePage embedded playlistView="local" />
    </div>
  );
}
