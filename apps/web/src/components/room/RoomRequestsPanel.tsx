"use client";

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
};

export function RoomRequestsPanel({ roomSnapshot, activeSessionId, onImportNeteaseTrack, onImportQqMusicTrack, onAddToQueue, onUpdateRoom }: Props) {
  const roomType = roomSnapshot.room.roomType ?? "interactive";
  const isHost = roomSnapshot.room.hostId === activeSessionId;
  const [requests, setRequests] = useState<RoomRequest[]>(roomSnapshot.room.requests ?? []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<NeteaseTrackCandidate | QqMusicTrackCandidate>>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const radioStatus = useRadioAutoFill({
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
  if (roomType === "interactive") return null;

  async function refresh() {
    setRequests(await musicRoomApi.listRoomRequests(roomSnapshot.room.id));
  }

  async function search() {
    const keywords = query.trim();
    if (!keywords) return;
    setPendingKey("search");
    try {
      const [netease, qqmusic] = await Promise.allSettled([
        musicRoomApi.searchNeteaseTracks(keywords, { limit: 8 }),
        musicRoomApi.searchQqMusicTracks(keywords, { limit: 8 })
      ]);
      setResults([
        ...(netease.status === "fulfilled" ? netease.value.items : []),
        ...(qqmusic.status === "fulfilled" ? qqmusic.value.items : [])
      ]);
    } finally {
      setPendingKey(null);
    }
  }

  async function requestSong(track: NeteaseTrackCandidate | QqMusicTrackCandidate) {
    const key = `${track.provider}:${track.providerTrackId}`;
    setPendingKey(key);
    try {
      await musicRoomApi.createRoomRequest(roomSnapshot.room.id, {
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl
      });
      await refresh();
    } finally { setPendingKey(null); }
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
    } finally { setPendingKey(null); }
  }

  return (
    <section className="mb-5 border-b border-white/[0.08] pb-5">
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white">{roomType === "radio" ? "点歌建议" : "点歌请求"}</h2><button className="text-xs text-accent" onClick={() => void refresh()} type="button">刷新</button></div>
      {roomType === "radio" ? <div className="mb-3 flex items-center justify-between gap-3 text-xs"><span className="text-white/45">{radioStatus ?? "使用当前歌曲作为推荐种子"}</span>{isHost ? <button className="text-accent" onClick={() => void onUpdateRoom({ visibility: roomSnapshot.room.visibility, name: roomSnapshot.room.name ?? "未命名房间", description: roomSnapshot.room.description, roomType, radioAutoFill: roomSnapshot.room.radioAutoFill === false })} type="button">{roomSnapshot.room.radioAutoFill === false ? "开启自动补歌" : "暂停自动补歌"}</button> : null}</div> : null}
      <div className="flex gap-2"><input className="min-w-0 flex-1 border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-accent" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void search()} placeholder="搜索网易云或 QQ 音乐" value={query} /><button className="border border-white/10 px-3 text-sm text-white" disabled={pendingKey === "search"} onClick={() => void search()} type="button">搜索</button></div>
      {results.length ? <div className="mt-3 grid gap-2">{results.map((track) => <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/[0.06] py-2" key={`${track.provider}:${track.providerTrackId}`}><span className="min-w-0 truncate text-sm text-white"><b>{track.title}</b><small className="ml-2 text-white/45">{track.artist}</small></span><button className="shrink-0 text-xs text-accent" disabled={pendingKey === `${track.provider}:${track.providerTrackId}`} onClick={() => void requestSong(track)} type="button">点歌</button></div>)}</div> : null}
      {isHost ? <RequestList requests={requests.filter((request) => request.status === "pending")} pendingKey={pendingKey} onDecide={decide} /> : <RequestList requests={ownRequests} pendingKey={pendingKey} />}
    </section>
  );
}

function RequestList({ requests, pendingKey, onDecide }: { requests: RoomRequest[]; pendingKey: string | null; onDecide?: (request: RoomRequest, decision: "approved" | "rejected") => Promise<void> }) {
  if (!requests.length) return null;
  return <div className="mt-4 grid gap-2">{requests.map((request) => <div className="flex items-center justify-between gap-3 border border-white/[0.08] px-3 py-2" key={request.id}><span className="min-w-0 truncate text-sm text-white">{request.title}<small className="ml-2 text-white/45">{request.artist} · {request.requesterName}</small></span>{onDecide ? <span className="flex shrink-0 gap-2"><button className="text-xs text-red-300" disabled={pendingKey === request.id} onClick={() => void onDecide(request, "rejected")} type="button">拒绝</button><button className="text-xs text-accent" disabled={pendingKey === request.id} onClick={() => void onDecide(request, "approved")} type="button">通过</button></span> : <span className="shrink-0 text-xs text-white/50">{statusLabel(request.status)}</span>}</div>)}</div>;
}

function statusLabel(status: RoomRequest["status"]) { return status === "pending" ? "待审核" : status === "approved" ? "已通过" : "已拒绝"; }
function toNeteaseCandidate(request: RoomRequest): NeteaseTrackCandidate { return { provider: "netease", providerTrackId: request.providerTrackId, access: "unknown", quality: null, title: request.title, artist: request.artist, album: request.album, durationMs: request.durationMs, artworkUrl: request.artworkUrl }; }
function toQqCandidate(request: RoomRequest): QqMusicTrackCandidate { return { provider: "qqmusic", providerTrackId: request.providerTrackId, access: "unknown", quality: null, title: request.title, artist: request.artist, album: request.album, durationMs: request.durationMs, artworkUrl: request.artworkUrl }; }
