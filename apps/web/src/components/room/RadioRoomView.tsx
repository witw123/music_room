"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate, QueueItem, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { MembersPanel } from "./MembersPanel";
import { RoomChatPanel } from "./RoomChatOverlay";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomStage } from "./RoomStage";
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";
import { useRadioAutopilot } from "./hooks/use-radio-autopilot";

type ProviderCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

export function RadioRoomView(props: RoomDashboardViewProps) {
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const playback = props.roomSnapshot.room.playback;
  const upcomingTracks = props.roomSnapshot.queue
    .filter((item) => item.id !== playback.currentQueueItemId)
    .map((queueItem) => ({
      queueItem,
      track: props.roomSnapshot.tracks.find((track) => track.id === queueItem.trackId)
    }))
    .filter((entry): entry is { queueItem: QueueItem; track: TrackMeta } => !!entry.track);
  const importAndQueue = async (candidate: ProviderCandidate) => {
    if (candidate.provider === "netease") {
      await props.onImportNeteaseTrack(candidate);
    } else {
      await props.onImportQqMusicTrack(candidate);
    }

    const snapshot = await musicRoomApi.getRoom(props.roomSnapshot.room.id);
    const track = snapshot.tracks.find((item) =>
      item.sourceRef?.provider === candidate.provider && item.sourceRef.trackId === candidate.providerTrackId
    );
    if (!track) throw new Error("歌曲已导入，但尚未同步到节目单。请稍后重试。");
    if (snapshot.queue.some((item) => item.trackId === track.id)) return;

    const queuedItem = await props.onAddToQueue(track.id);
    if (!queuedItem) throw new Error("歌曲已导入，但未能加入节目单。请稍后重试。");
  };

  useEffect(() => {
    const timer = window.setInterval(() => setMembershipNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hide-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-32" data-room-view="radio">
      <section className="mx-auto grid w-full max-w-[1600px] border-b border-surface-border lg:min-h-[36rem] lg:grid-cols-[minmax(20rem,38fr)_minmax(0,62fr)]">
        <RadioProgramSchedule
          className="order-2 lg:order-1"
          currentTrack={props.currentTrack}
          isHost={isHost}
          onImportNeteaseTrack={importAndQueue}
          onImportQqMusicTrack={importAndQueue}
          roomTracks={props.roomSnapshot.tracks}
          upcomingTracks={upcomingTracks}
        />
        <section className="order-1 min-h-[30rem] border-b border-surface-border bg-surface/[0.12] lg:order-2 lg:min-h-0 lg:border-b-0 lg:border-l">
          <RoomStage {...buildRoomStageProps(props, { hideRoomMetadata: true, showMobilePlayer: true })} />
        </section>
      </section>

      <section className={`mx-auto grid w-full max-w-[1600px] ${isHost ? "lg:grid-cols-[minmax(20rem,38fr)_minmax(20rem,34fr)_minmax(18rem,28fr)]" : "lg:grid-cols-[minmax(0,62fr)_minmax(18rem,38fr)]"}`}>
        {isHost ? <HostBroadcastDesk {...props} /> : null}
        <RadioCommunityPanels {...props} membershipNow={membershipNow} />
      </section>
    </div>
  );
}

function RadioProgramSchedule({
  className,
  currentTrack,
  isHost,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  roomTracks,
  upcomingTracks
}: {
  className: string;
  currentTrack: TrackMeta | null;
  isHost: boolean;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  roomTracks: TrackMeta[];
  upcomingTracks: Array<{ queueItem: QueueItem; track: TrackMeta }>;
}) {
  return (
    <aside className={`${className} flex min-h-[22rem] min-w-0 flex-col bg-surface/[0.14]`} data-testid="radio-program-schedule">
      <header className="shrink-0 px-4 py-5 sm:px-6 lg:px-7">
        <h1 className="text-xl font-semibold text-foreground">节目单</h1>
      </header>
      <div className="hide-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6 lg:px-7">
        <div className="space-y-1">
          {currentTrack ? <div className="border-b border-surface-border pb-2"><ProgramTrack index={1} track={currentTrack} isCurrent /></div> : null}
          {upcomingTracks.map(({ queueItem, track }, index) => <ProgramTrack key={queueItem.id} index={currentTrack ? index + 2 : index + 1} track={track} />)}
        </div>
        {isHost ? <div className="mt-auto"><RoomProviderTrackSearch canManageLibrary hideUnavailableProvidersNotice mode="program" onImportNeteaseTrack={onImportNeteaseTrack} onImportQqMusicTrack={onImportQqMusicTrack} roomTracks={roomTracks} surface="plain" testId="radio-room-program" /></div> : null}
      </div>
    </aside>
  );
}

function RadioCommunityPanels(props: RoomDashboardViewProps & { membershipNow: number }) {
  const [mobileTab, setMobileTab] = useState<"chat" | "members">("chat");

  return (
    <>
      <div className="col-span-full border-b border-surface-border bg-background px-4 py-3 lg:hidden">
        <div aria-label="电台社区" className="grid grid-cols-2 border border-surface-border p-1" role="tablist">
          <button aria-controls="radio-chat" aria-selected={mobileTab === "chat"} className={`min-h-10 px-3 text-sm font-medium transition-colors ${mobileTab === "chat" ? "bg-accent text-white" : "text-foreground-muted"}`} onClick={() => setMobileTab("chat")} role="tab" type="button">聊天</button>
          <button aria-controls="radio-members" aria-selected={mobileTab === "members"} className={`min-h-10 px-3 text-sm font-medium transition-colors ${mobileTab === "members" ? "bg-accent text-white" : "text-foreground-muted"}`} onClick={() => setMobileTab("members")} role="tab" type="button">成员</button>
        </div>
      </div>
      <div className={mobileTab === "chat" ? "block border-b border-surface-border bg-background lg:border-b-0 lg:border-r" : "hidden border-b border-surface-border bg-background lg:block lg:border-b-0 lg:border-r"} id="radio-chat" role="tabpanel">
        <RoomChatPanel activeSession={props.activeSession} roomId={props.roomSnapshot.room.id} socket={props.socket} />
      </div>
      <div className={mobileTab === "members" ? "block bg-background" : "hidden bg-background lg:block"} id="radio-members" role="tabpanel">
        <section className="min-h-[24rem] bg-surface/25">
          <header className="px-4 py-4 sm:px-5">
            <h2 className="text-base font-semibold text-foreground">成员</h2>
          </header>
          <div className="p-3 sm:p-4">
            <MembersPanel
              activeSessionId={props.activeSession?.userId ?? null}
              isHost={props.roomSnapshot.room.hostId === props.activeSession?.userId}
              members={props.roomSnapshot.room.members}
              now={props.membershipNow}
              onRemoveMember={props.onRemoveMember}
              onUpdateMemberPermissions={props.onUpdateMemberPermissions}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function HostBroadcastDesk(props: RoomDashboardViewProps) {
  const [message, setMessage] = useState<string | null>(null);
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const isAutopilotEnabled = props.roomSnapshot.room.radioAutopilot?.enabled === true;
  const currentProviderTrack = props.currentTrack?.sourceRef &&
    (props.currentTrack.sourceType === "netease" || props.currentTrack.sourceType === "qqmusic")
    ? props.currentTrack
    : null;
  const autopilot = useRadioAutopilot({
    roomSnapshot: props.roomSnapshot,
    isHost,
    onImportNeteaseTrack: props.onImportNeteaseTrack,
    onImportQqMusicTrack: props.onImportQqMusicTrack,
    onRefreshRoom: props.onRefreshRoom
  });

  const toggleAutopilot = async () => {
    setMessage(null);
    try {
      await musicRoomApi.updateRadioAutopilot(props.roomSnapshot.room.id, { enabled: !isAutopilotEnabled });
      await props.onRefreshRoom();
      setMessage(isAutopilotEnabled ? "自动续播已停止。" : "自动续播已开启。房主页面会根据当前歌曲补足节目单。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动续播设置失败。请稍后重试。");
    }
  };

  return (
    <aside className="min-w-0 border-b border-surface-border bg-background px-4 py-6 sm:px-6 lg:border-b-0 lg:border-r lg:px-7 lg:py-7" data-testid="radio-host-console">
      <div>
        <h2 className="text-base font-semibold text-foreground">主持人控制台</h2>
      </div>
      <section className="mt-5 border-l-2 border-accent/50 pl-4" data-testid="radio-autopilot">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">自动续播</h3>
        </div>
        {currentProviderTrack ? <p className="mt-1 truncate text-xs text-foreground-muted">{currentProviderTrack.title} · {currentProviderTrack.artist}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!isAutopilotEnabled && !currentProviderTrack} onClick={() => void toggleAutopilot()} size="sm" type="button" variant={isAutopilotEnabled ? "outline" : "default"}>{isAutopilotEnabled ? "停止自动续播" : "开启自动续播"}</Button>
          {autopilot.state.kind === "paused" && currentProviderTrack ? <Button onClick={() => void autopilot.retry()} size="sm" type="button" variant="outline">重试补歌</Button> : null}
        </div>
        {autopilot.state.message ? <p className={`mt-3 text-xs leading-5 ${autopilot.state.kind === "paused" ? "text-amber-200" : "text-foreground-muted"}`} role="status">{autopilot.state.message}</p> : null}
      </section>
      {message ? <p className="mt-4 text-sm text-foreground-muted" role="status">{message}</p> : null}
    </aside>
  );
}

function ProgramTrack({ track, index, isCurrent = false }: { track: TrackMeta; index: number; isCurrent?: boolean }) {
  return <article className={`flex min-w-0 items-center gap-3 px-2 py-3 sm:px-3 ${isCurrent ? "bg-accent/[0.06]" : ""}`}><span className={`w-5 text-right font-mono text-xs ${isCurrent ? "text-accent" : "text-foreground-muted"}`}>{String(index).padStart(2, "0")}</span><TrackArtwork track={track} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{track.title}</p><p className="mt-1 truncate text-xs text-foreground-muted">{track.artist}</p></div></article>;
}

function TrackArtwork({ track }: { track: TrackMeta }) {
  return track.artworkUrl ? <img alt="" className="h-10 w-10 shrink-0 object-cover" src={track.artworkUrl} /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted">音乐</span>;
}
