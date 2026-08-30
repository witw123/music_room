"use client";

import { useState, type FormEvent, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { getNewMemberPermissions } from "@music-room/shared";
import type {
  RoomMember,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackMeta,
  UpdateRoomRequest
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MemberPermissionControls } from "./MembersPanel";

export function getSourceModeLabel(
  mediaConnectionState: RoomMediaConnectionState,
  currentTrack: TrackMeta | null
) {
  if (!currentTrack) {
    return "未选择歌曲";
  }

  if (!currentTrack.playbackAsset) {
    return "不支持的旧版曲目";
  }
  if (mediaConnectionState === "failed") {
    return "音源暂不可用";
  }
  if (mediaConnectionState === "connecting" || mediaConnectionState === "reconnecting") {
    return "正在连接音源";
  }
  if (mediaConnectionState === "buffering") {
    return "等待 RTP Opus 媒体轨道";
  }
  return "WebRTC RTP Opus 播放";
}

function buildRoomEditForm(roomSnapshot: RoomSnapshot): UpdateRoomRequest {
  return {
    visibility: roomSnapshot.room.visibility,
    name: roomSnapshot.room.name ?? "",
    description: roomSnapshot.room.description ?? "",
    password: "",
    newMemberPermissions: getNewMemberPermissions(roomSnapshot.room)
  };
}

export type RoomControlHeaderProps = {
  roomSnapshot: RoomSnapshot;
  mediaConnectionState?: RoomMediaConnectionState;
  currentTrack?: TrackMeta | null;
  host?: RoomMember;
  canDeleteRoom?: boolean;
  canDisbandRoom?: boolean;
  onCopyJoinCode?: () => Promise<void> | void;
  onShareRoom?: () => Promise<void> | void;
  onAwayRoom?: () => void;
  onLeaveRoom?: () => Promise<void> | void;
  onDeleteRoom?: () => Promise<void> | void;
  onUpdateRoom?: (input: UpdateRoomRequest) => Promise<boolean>;
  hideRoomMetadata?: boolean;
  className?: string;
};

export function RoomControlHeader({
  roomSnapshot,
  mediaConnectionState = "live",
  currentTrack = null,
  host: propHost,
  canDeleteRoom = false,
  canDisbandRoom = false,
  onCopyJoinCode,
  onShareRoom,
  onAwayRoom,
  onLeaveRoom,
  onDeleteRoom,
  onUpdateRoom,
  hideRoomMetadata = false,
  className = ""
}: RoomControlHeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [showEditRoom, setShowEditRoom] = useState(false);
  const [isUpdatingRoom, setIsUpdatingRoom] = useState(false);
  const [editRoomForm, setEditRoomForm] = useState<UpdateRoomRequest>(() =>
    buildRoomEditForm(roomSnapshot)
  );
  const [isCopying, setIsCopying] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const host = propHost ?? roomSnapshot.room.members.find(
    (member) => member.id === roomSnapshot.room.hostId || member.role === "host"
  );
  const onlineMemberCount = roomSnapshot.room.members.filter(
    (member) => member.presenceState !== "offline"
  ).length;
  const sourceModeLabel = getSourceModeLabel(mediaConnectionState, currentTrack);

  const handleCopyJoinCode = async () => {
    if (isCopying || !onCopyJoinCode) return;
    setIsCopying(true);
    try {
      await onCopyJoinCode();
    } finally {
      window.setTimeout(() => setIsCopying(false), 1200);
    }
  };

  const handleShareRoom = async () => {
    if (isSharing || !onShareRoom) return;
    setIsSharing(true);
    try {
      await onShareRoom();
    } finally {
      window.setTimeout(() => setIsSharing(false), 1200);
    }
  };

  const handleDeleteRoom = async () => {
    if (!onDeleteRoom) return;
    setIsDeletingRoom(true);
    try {
      await onDeleteRoom();
      setShowDeleteConfirmation(false);
    } finally {
      setIsDeletingRoom(false);
    }
  };

  const openEditRoom = () => {
    setEditRoomForm(buildRoomEditForm(roomSnapshot));
    setShowSettings(false);
    setShowEditRoom(true);
  };

  const handleUpdateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onUpdateRoom || isUpdatingRoom || !editRoomForm.name.trim()) return;
    setIsUpdatingRoom(true);
    try {
      const updated = await onUpdateRoom({
        visibility: editRoomForm.visibility,
        name: editRoomForm.name.trim(),
        description: editRoomForm.description?.trim() || null,
        password: editRoomForm.password?.trim() ?? "",
        ...(roomSnapshot.room.roomType === "interactive"
          ? { newMemberPermissions: editRoomForm.newMemberPermissions }
          : {})
      });
      if (updated) setShowEditRoom(false);
    } finally {
      setIsUpdatingRoom(false);
    }
  };

  return (
    <>
      <div className={`flex w-full items-start justify-between gap-3 ${className}`}>
        {hideRoomMetadata ? null : (
          <div className="min-w-0 space-y-1.5">
            <div className="flex max-w-full items-center gap-2">
              <button
                data-testid="room-code-button"
                aria-label="复制房间码"
                className="group flex min-w-0 max-w-full items-center gap-2"
                disabled={isCopying || !onCopyJoinCode}
                onClick={() => void handleCopyJoinCode()}
                type="button"
              >
                <div className="light-control-surface flex min-w-0 items-center gap-2 rounded-full border border-white/5 bg-white/10 px-3 py-1.5 shadow-sm backdrop-blur-md transition-colors group-hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgba(0,112,243,0.8)]" />
                  <span className="truncate font-mono text-[11px] font-bold tracking-[0.28em] text-white">
                    {roomSnapshot.room.joinCode}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="shrink-0 text-white/50 group-hover:text-white"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </div>
                {isCopying ? <span className="text-[10px] font-medium text-accent">已复制</span> : null}
              </button>

              {onShareRoom ? (
                <button
                  data-testid="share-room-button"
                  aria-label="分享房间"
                  className="light-control-surface inline-flex h-8 min-w-[5.25rem] shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-2.5 text-[11px] font-semibold text-white/75 shadow-sm backdrop-blur-md transition-[background-color,color,border-color,transform] duration-150 hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-wait disabled:opacity-60"
                  disabled={isSharing}
                  onClick={() => void handleShareRoom()}
                  title="分享房间"
                  type="button"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="m8.6 13.5 6.8 4" />
                    <path d="m15.4 6.5-6.8 4" />
                  </svg>
                  <span>{isSharing ? "已复制" : "分享房间"}</span>
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] tracking-[0.18em] text-white/50">
              <span className="flex items-center gap-1">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span data-testid="online-member-count">{onlineMemberCount}</span> 人在线
              </span>
              <span>·</span>
              <span>{roomSnapshot.room.visibility === "public" ? "公开房间" : "私密房间"}</span>
              {host ? (
                <>
                  <span>·</span>
                  <span>房主 {host.nickname}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{sourceModeLabel}</span>
            </div>
          </div>
        )}

        <div className="relative ml-auto shrink-0 pointer-events-auto">
          <Button
            data-testid="room-settings-button"
            variant="ghost"
            size="icon"
            className="light-overlay-control h-8.5 w-8.5 sm:h-10 sm:w-10 rounded-full border border-white/10 bg-white/5 text-white/70 backdrop-blur-md transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out hover:bg-white/15 hover:text-white"
            onClick={() => setShowSettings((value) => !value)}
            type="button"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </Button>

          {showSettings ? (
            <>
              <div
                className="fixed inset-0 z-[55]"
                onClick={() => setShowSettings(false)}
              />
              <div className="light-popover-surface animate-fade-in absolute right-0 top-11 z-[60] flex w-56 origin-top-right flex-col rounded-2xl border border-white/10 bg-[#12141c]/95 p-1 shadow-2xl backdrop-blur-xl">
                {canDeleteRoom && onUpdateRoom ? (
                  <button
                    data-testid="edit-room-button"
                    className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                    onClick={openEditRoom}
                    type="button"
                  >
                    编辑房间
                  </button>
                ) : null}
                {onAwayRoom ? (
                  <button
                    data-testid="away-room-button"
                    className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-amber-200 transition-colors hover:bg-amber-300/10 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                    onClick={() => {
                      setShowSettings(false);
                      onAwayRoom();
                    }}
                    type="button"
                  >
                    暂离房间
                  </button>
                ) : null}
                <button
                  data-testid="leave-room-button"
                  className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                  onClick={() => {
                    setShowSettings(false);
                    void onLeaveRoom?.();
                  }}
                  type="button"
                >
                  离开房间
                </button>

                {(canDeleteRoom || canDisbandRoom) && onDeleteRoom ? (
                  <>
                    <button
                      data-testid="delete-room-button"
                      className="my-1 w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                      onClick={() => {
                        setShowSettings(false);
                        setShowDeleteConfirmation(true);
                      }}
                      title="解散房间"
                      type="button"
                    >
                      解散房间
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        confirmLabel="解散房间"
        description="房间、队列和共享曲库状态将被删除，所有成员都会离开。此操作无法撤销。"
        destructive
        onCancel={() => setShowDeleteConfirmation(false)}
        onConfirm={() => void handleDeleteRoom()}
        open={showDeleteConfirmation}
        pending={isDeletingRoom}
        title="确认解散房间？"
      />

      {onUpdateRoom ? (
        <RoomEditDialog
          form={editRoomForm}
          roomType={roomSnapshot.room.roomType}
          onChange={setEditRoomForm}
          onClose={() => {
            if (!isUpdatingRoom) setShowEditRoom(false);
          }}
          onSubmit={handleUpdateRoom}
          open={showEditRoom}
          pending={isUpdatingRoom}
        />
      ) : null}
    </>
  );
}

export function RoomEditDialog({
  form,
  roomType,
  onChange,
  onClose,
  onSubmit,
  open,
  pending
}: {
  form: UpdateRoomRequest;
  roomType: RoomSnapshot["room"]["roomType"];
  onChange: Dispatch<SetStateAction<UpdateRoomRequest>>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  open: boolean;
  pending: boolean;
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="light-overlay-scrim fixed inset-0 z-[500] flex items-start justify-center overflow-y-auto bg-black/75 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-sm sm:items-center"
      onClick={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-labelledby="edit-room-dialog-title"
        aria-modal="true"
        className="light-dialog-surface max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-surface p-5 shadow-2xl sm:p-6"
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground" id="edit-room-dialog-title">
              编辑房间
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-foreground-muted">
              修改房间信息后立即同步给当前成员。
            </p>
          </div>
          <button
            aria-label="关闭"
            className="rounded-lg px-2 py-1 text-xl leading-none text-foreground-muted hover:bg-white/10 hover:text-foreground"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div
            className="flex gap-2 rounded-xl border border-white/10 bg-black/20 p-1"
            role="tablist"
            aria-label="房间可见性"
          >
            {(["public", "private"] as const).map((visibility) => (
              <button
                aria-selected={form.visibility === visibility}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  form.visibility === visibility
                    ? "bg-accent text-white"
                    : "text-foreground-muted hover:bg-white/10"
                }`}
                key={visibility}
                onClick={() => onChange((current) => ({ ...current, visibility }))}
                role="tab"
                type="button"
              >
                {visibility === "public" ? "公开房间" : "私密房间"}
              </button>
            ))}
          </div>
          <div className="border border-white/10 bg-black/20 px-3 py-2.5">
            <span className="block text-xs text-foreground-muted">房间类型</span>
            <span className="mt-1 block text-sm font-medium text-foreground">
              {roomType === "request"
                ? "点歌房"
                : roomType === "radio"
                  ? "自由电台"
                  : "多人互动房"}
            </span>
            <span className="mt-1 block text-xs text-foreground-muted">创建后不可更改。</span>
          </div>
          <label className="flex flex-col gap-2 text-sm text-foreground">
            房间名称
            <input
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
              maxLength={120}
              onChange={(event) =>
                onChange((current) => ({ ...current, name: event.target.value }))
              }
              required
              value={form.name}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-foreground">
            房间简介 <span className="text-xs text-foreground-muted">可选</span>
            <textarea
              className="min-h-20 resize-y rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
              maxLength={500}
              onChange={(event) =>
                onChange((current) => ({ ...current, description: event.target.value }))
              }
              rows={3}
              value={form.description ?? ""}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-foreground">
            房间密码 <span className="text-xs text-foreground-muted">留空表示移除密码，至少 4 位</span>
            <input
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-foreground caret-accent outline-none placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent"
              maxLength={128}
              minLength={4}
              onChange={(event) =>
                onChange((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="留空表示无需密码"
              type="password"
              value={form.password ?? ""}
            />
          </label>
          {roomType === "interactive" ? (
            <div className="flex flex-col gap-2">
              <div>
                <span className="block text-sm text-foreground">新成员默认权限</span>
                <span className="mt-1 block text-xs text-foreground-muted">
                  只影响之后首次进入房间的成员，已有成员权限不会改变。
                </span>
              </div>
              <MemberPermissionControls
                onChange={(permission, checked) =>
                  onChange((current) => ({
                    ...current,
                    newMemberPermissions: {
                      ...getNewMemberPermissions(current),
                      [permission]: checked
                    }
                  }))
                }
                permissions={getNewMemberPermissions({
                  newMemberPermissions: form.newMemberPermissions
                })}
                disabled={pending}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button disabled={pending} onClick={onClose} type="button" variant="outline">
              取消
            </Button>
            <Button
              disabled={
                pending ||
                !form.name.trim() ||
                (!!form.password?.trim() && form.password.trim().length < 4)
              }
              type="submit"
            >
              {pending ? "保存中..." : "保存修改"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
