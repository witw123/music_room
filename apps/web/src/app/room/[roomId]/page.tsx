import { MusicRoomApp } from "@/components/music-room-app";

export default async function RoomPage({
  params
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return <MusicRoomApp initialRoomId={roomId} workspaceOnly />;
}
