"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate, RoomRequest, RoomSnapshot, UpdateRoomRequest } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { useRadioAutoFill } from "./use-radio-auto-fill";

type Props = {
  roomSnapshot: RoomSnapshot;
  activeSessionId: string | null;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onUpdateRoom: (input: UpdateRoomRequest) => Promise<boolean>;
  variant: "request" | "radio";
};

export type RequestableProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;

export async function submitRoomTrackRequest(roomId: string, track: RequestableProviderTrack) {
  await musicRoomApi.createRoomRequest(roomId, {
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl
  });
}

export function RoomRequestsPanel({
  roomSnapshot,
  activeSessionId,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onAddToQueue,
  onUpdateRoom,
  variant
}: Props) {
  const roomType = roomSnapshot.room.roomType ?? "interactive";
  const isHost = roomSnapshot.room.hostId === activeSessionId;
  const [requests, setRequests] = useState<RoomRequest[]>(roomSnapshot.room.requests ?? []);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useRadioAutoFill({
    roomSnapshot,
    enabled: roomType === "radio",
    isHost,
    onImportNeteaseTrack,
    onImportQqMusicTrack,
    onAddToQueue
  });

  useEffect(() => setRequests(roomSnapshot.room.requests ?? []), [roomSnapshot.room.requests]);
  const ownRequests = useMemo(
    () => requests.filter((request) => request.requesterId === activeSessionId),
    [activeSessionId, requests]
  );
  const visibleRequests = isHost ? requests.filter((request) => request.status === "pending") : ownRequests;

  async function refresh() {
    setRequests(await musicRoomApi.listRoomRequests(roomSnapshot.room.id));
  }

  async function decide(request: RoomRequest, decision: "approved" | "rejected") {
    setPendingKey(request.id);
    try {
      if (decision === "approved") {
        if (request.provider === "netease") {
          await onImportNeteaseTrack(toNeteaseCandidate(request));
        } else if (request.provider === "qqmusic") {
          await onImportQqMusicTrack(toQqCandidate(request));
        } else {
          throw new Error("本地点歌需要房主先将歌曲导入曲库。");
        }
        const refreshed = await musicRoomApi.getRoom(roomSnapshot.room.id);
        const track = refreshed.tracks.find((item) =>
          item.sourceRef?.provider === request.provider && item.sourceRef.trackId === request.providerTrackId
        );
        if (!track) throw new Error("歌曲导入未完成，请稍后重试。");
        await onAddToQueue(track.id);
      }
      if (decision === "approved") await musicRoomApi.approveRoomRequest(roomSnapshot.room.id, request.id);
      else await musicRoomApi.rejectRoomRequest(roomSnapshot.room.id, request.id);
      await refresh();
    } finally {
      setPendingKey(null);
    }
  }

  const title = variant === "radio" ? "点歌建议" : isHost ? "待审核" : "我的点歌";
  return <section className="flex min-h-0 min-w-0 flex-col" data-testid="room-requests-panel">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <button className="text-xs text-accent transition hover:text-accent/80" onClick={() => void refresh()} type="button">刷新</button>
    </div>
    {variant === "radio" && isHost ? <div className="mb-3 flex justify-end border-b border-surface-border pb-3 text-xs">
      <button className="text-accent transition hover:text-accent/80" onClick={() => void onUpdateRoom({
        visibility: roomSnapshot.room.visibility,
        name: roomSnapshot.room.name ?? "未命名房间",
        description: roomSnapshot.room.description,
        roomType,
        radioAutoFill: roomSnapshot.room.radioAutoFill === false
      })} type="button">{roomSnapshot.room.radioAutoFill === false ? "开启自动补歌" : "暂停自动补歌"}</button>
    </div> : null}
    <RequestList requests={visibleRequests} pendingKey={pendingKey} onDecide={isHost ? decide : undefined} />
  </section>;
}

function RequestList({
  requests,
  pendingKey,
  onDecide
}: {
  requests: RoomRequest[];
  pendingKey: string | null;
  onDecide?: (request: RoomRequest, decision: "approved" | "rejected") => Promise<void>;
}) {
  if (!requests.length) return <p className="py-5 text-center text-xs text-foreground-muted">暂无点歌</p>;
  return <div className="min-h-0 divide-y divide-surface-border border-y border-surface-border">
    {requests.map((request) => <article className="flex min-w-0 items-center gap-3 py-3" key={request.id}>
      {request.artworkUrl ? <img alt="" className="h-9 w-9 shrink-0 object-cover" src={request.artworkUrl} /> : <span className="h-9 w-9 shrink-0 bg-surface" />}
      <div className="min-w-0 flex-1"><strong className="block truncate text-xs font-semibold text-foreground">{request.title}</strong><span className="mt-0.5 block truncate text-[11px] text-foreground-muted">{request.artist} · {request.requesterName}</span></div>
      {onDecide ? <span className="flex shrink-0 gap-2"><button className="text-xs text-red-300" disabled={pendingKey === request.id} onClick={() => void onDecide(request, "rejected")} type="button">拒绝</button><button className="text-xs text-accent" disabled={pendingKey === request.id} onClick={() => void onDecide(request, "approved")} type="button">通过</button></span> : <span className="shrink-0 text-xs text-foreground-muted">{statusLabel(request.status)}</span>}
    </article>)}
  </div>;
}

function statusLabel(status: RoomRequest["status"]) { return status === "pending" ? "待审核" : status === "approved" ? "已通过" : "已拒绝"; }
function toNeteaseCandidate(request: RoomRequest): NeteaseTrackCandidate { return { provider: "netease", providerTrackId: request.providerTrackId, access: "unknown", quality: null, title: request.title, artist: request.artist, album: request.album, durationMs: request.durationMs, artworkUrl: request.artworkUrl }; }
function toQqCandidate(request: RoomRequest): QqMusicTrackCandidate { return { provider: "qqmusic", providerTrackId: request.providerTrackId, access: "unknown", quality: null, title: request.title, artist: request.artist, album: request.album, durationMs: request.durationMs, artworkUrl: request.artworkUrl }; }
