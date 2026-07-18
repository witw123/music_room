import { AppPlaceholderPage } from "@/components/AppPlaceholderPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PlaylistsPage() {
  return (
    <AppPlaceholderPage
      page="playlists"
      eyebrow="Playlists"
      title="歌单"
      description="集中管理你的音乐收藏与协作歌单。"
    />
  );
}
