import { PlaylistsWorkspacePage } from "@/components/playlists";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LocalPlaylistsPage() {
  return <PlaylistsWorkspacePage playlistView="local" />;
}
