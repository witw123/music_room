import { AppOnlyNoticePage } from "@/components/AppOnlyNoticePage";
import { MusicRoomApp } from "@/components/music-room-app";
import { getClientPlatformFromRequest } from "@/lib/client-shell-server";

export default async function RoomPage({
  params,
  searchParams
}: {
  params: Promise<{ roomId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clientPlatform = await getClientPlatformFromRequest(searchParams);

  if (!clientPlatform) {
    return (
      <AppOnlyNoticePage
        title="房间页面仅在客户端中开放"
        description="浏览器访问房间链接时只会显示下载引导。请在客户端中打开房间，继续同步播放和协作听歌。"
      />
    );
  }

  const { roomId } = await params;

  return <MusicRoomApp initialRoomId={roomId} workspaceOnly />;
}
