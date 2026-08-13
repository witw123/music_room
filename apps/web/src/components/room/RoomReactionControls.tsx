"use client";

import { useEffect, useState } from "react";
import type { RoomReactionPayload } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import type { RoomSocket } from "@/lib/network/ws-client";

type RoomReactionControlsProps = {
  roomId: string;
  trackId: string | null;
  socket: RoomSocket | null;
  className?: string;
};

export function RoomReactionControls({ roomId, trackId, socket, className = "" }: RoomReactionControlsProps) {
  const [reactionCounts, setReactionCounts] = useState({ like: 0, applause: 0 });

  useEffect(() => {
    if (!socket) return;
    const receiveReaction = (payload: RoomReactionPayload) => {
      if (payload.trackId !== trackId) return;
      setReactionCounts((current) => ({ ...current, [payload.reaction]: payload.totalCount }));
    };
    socket.on("room.reaction", receiveReaction);
    return () => {
      socket.off("room.reaction", receiveReaction);
    };
  }, [socket, trackId]);

  useEffect(() => {
    let cancelled = false;
    setReactionCounts({ like: 0, applause: 0 });
    void musicRoomApi.getRoomReactionCounts(roomId, trackId)
      .then((counts) => { if (!cancelled) setReactionCounts(counts); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [roomId, trackId]);

  return <div className={`flex items-center gap-2 ${className}`}>
    <button aria-label="点赞" className="light-control-surface inline-flex h-8 items-center gap-1 border border-white/10 bg-white/10 px-2 text-xs text-white/80 hover:bg-white/20" onClick={() => socket?.emit("room.reaction", { roomId, reaction: "like", trackId })} type="button">♥ <span>{reactionCounts.like}</span></button>
    <button aria-label="鼓掌" className="light-control-surface inline-flex h-8 items-center gap-1 border border-white/10 bg-white/10 px-2 text-xs text-white/80 hover:bg-white/20" onClick={() => socket?.emit("room.reaction", { roomId, reaction: "applause", trackId })} type="button">鼓掌 <span>{reactionCounts.applause}</span></button>
  </div>;
}
