import { PlaylistsWorkspacePage } from "@/components/PlaylistsWorkspacePage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LocalPlaylistsPage() {
  return <PlaylistsWorkspacePage playlistView="local" />;
}
