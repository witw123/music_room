import type { TrackMeta } from "@music-room/shared";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { ManualCacheTask } from "@/features/upload/manual-cache-task-store";

export type RoomCacheFilter = "all" | "active" | "available" | "completed";
export type RoomCacheAction = "download" | "pause" | "resume" | "retry";
export type RoomCacheStatusKey =
  | "cached"
  | "assembling"
  | "finalizing"
  | "integrity-failed"
  | "failed"
  | "paused"
  | "waiting"
  | "downloading"
  | "available";

export type RoomCacheRow = {
  track: TrackMeta;
  status: {
    key: RoomCacheStatusKey;
    label: string;
    tone: "neutral" | "success" | "warning" | "danger";
  };
  category: Exclude<RoomCacheFilter, "all">;
  detail: string;
  progress: { completed: number; total: number; percent: number; label: string };
  speedLabel: string | null;
  aheadLabel: string | null;
  action: RoomCacheAction | null;
  actionDisabled: boolean;
};

type DeriveRoomCacheRowInput = {
  track: TrackMeta;
  task: ManualCacheTask | null;
  cachedTrack: Pick<CachedLibraryTrack, "fileHash"> | null;
  remotePeerCount: number;
  availableTotalChunks: number;
};

function formatDownloadRate(downloadRateKbps: number | null | undefined) {
  if (typeof downloadRateKbps !== "number" || !Number.isFinite(downloadRateKbps) || downloadRateKbps <= 0) {
    return null;
  }
  const bytesPerSecond = downloadRateKbps * 1000 / 8;
  return bytesPerSecond >= 1024 * 1024
    ? `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
    : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

function formatAhead(activeAheadMs: number | null | undefined) {
  if (typeof activeAheadMs !== "number" || !Number.isFinite(activeAheadMs) || activeAheadMs <= 0) {
    return null;
  }
  return `已缓冲 ${Math.max(1, Math.round(activeAheadMs / 1000))} 秒`;
}

function formatBlockedReason(reason: string | null | undefined) {
  switch (reason) {
    case "missing-track":
      return "歌曲信息已失效。";
    case "missing-manifest":
      return "正在等待歌曲分片信息。";
    case "complete":
      return "缓存分片已完整，正在生成文件。";
    case "no-provider":
      return "当前没有在线成员可提供缓存。";
    case "provider-not-connected":
      return "缓存来源正在重新连接。";
    case "provider-has-no-requestable-chunks":
      return "当前来源暂时没有可下载的新分片。";
    case "pending-window-full":
      return "正在等待已请求的分片返回。";
    default:
      return "缓存暂时无法继续，正在等待恢复。";
  }
}

function buildProgress(input: DeriveRoomCacheRowInput) {
  const total = Math.max(
    0,
    input.task?.totalChunks ?? 0,
    input.availableTotalChunks,
    input.track.relayManifest?.totalChunks ?? 0,
    input.track.pieceManifest?.totalChunks ?? 0
  );
  const completed = input.cachedTrack
    ? total
    : Math.min(Math.max(0, input.task?.completedChunks ?? 0), total || Number.MAX_SAFE_INTEGER);
  return {
    completed,
    total,
    percent: input.cachedTrack ? 100 : total > 0 ? Math.min(100, Math.round(completed / total * 100)) : 0,
    label: input.cachedTrack
      ? "缓存完整"
      : total > 0
        ? `${completed}/${total} 分片`
        : "等待分片信息"
  };
}

export function deriveRoomCacheRow(input: DeriveRoomCacheRowInput): RoomCacheRow {
  const { task } = input;
  const hasProvider = input.remotePeerCount > 0 && input.availableTotalChunks > 0;
  const progress = buildProgress(input);

  if (input.cachedTrack) {
    return {
      track: input.track,
      status: { key: "cached", label: "已缓存", tone: "success" },
      category: "completed",
      detail: "完整无损文件已保存在本机。",
      progress,
      speedLabel: null,
      aheadLabel: null,
      action: null,
      actionDisabled: true
    };
  }

  if (task?.status === "assembling") {
    return buildTaskRow(input, progress, "assembling", "组装中", "正在校验并生成完整无损文件。", null, true);
  }
  if (task?.status === "ready") {
    return buildTaskRow(input, progress, "finalizing", "正在完成", "缓存已完成，正在更新本机缓存库。", null, true);
  }
  if (task?.status === "failed-integrity") {
    return buildTaskRow(
      input,
      progress,
      "integrity-failed",
      "校验失败",
      task.errorMessage ?? "文件完整性校验失败，请重新下载。",
      "retry",
      !hasProvider
    );
  }
  if (task?.status === "failed") {
    return buildTaskRow(
      input,
      progress,
      "failed",
      "下载失败",
      task.errorMessage ?? task.lastError ?? "下载中断，请重新尝试。",
      "retry",
      !hasProvider
    );
  }
  if (task?.status === "paused") {
    return buildTaskRow(input, progress, "paused", "已暂停", `已保存 ${progress.label}。`, "resume", !hasProvider);
  }
  if (task?.status === "blocked" || ((task?.status === "queued" || task?.status === "downloading") && !hasProvider)) {
    return buildTaskRow(
      input,
      progress,
      "waiting",
      "等待来源",
      formatBlockedReason(task?.blockedReason),
      hasProvider ? "retry" : null,
      !hasProvider
    );
  }
  if (task?.status === "queued" || task?.status === "downloading") {
    const detail = task.mode === "playback-demand"
      ? "正在为当前播放补充无损缓存。"
      : `正在下载，已完成 ${progress.label}。`;
    return buildTaskRow(input, progress, "downloading", "下载中", detail, "pause", false);
  }
  if (!hasProvider) {
    return {
      track: input.track,
      status: { key: "waiting", label: "等待来源", tone: "warning" },
      category: "available",
      detail: "提供者上线后即可开始缓存。",
      progress,
      speedLabel: null,
      aheadLabel: null,
      action: null,
      actionDisabled: true
    };
  }
  return {
    track: input.track,
    status: { key: "available", label: "可缓存", tone: "neutral" },
    category: "available",
    detail: "可下载完整无损文件到本机。",
    progress,
    speedLabel: null,
    aheadLabel: null,
    action: "download",
    actionDisabled: false
  };
}

function buildTaskRow(
  input: DeriveRoomCacheRowInput,
  progress: RoomCacheRow["progress"],
  key: RoomCacheStatusKey,
  label: string,
  detail: string,
  action: RoomCacheAction | null,
  actionDisabled: boolean
): RoomCacheRow {
  const isDownloading = key === "downloading";
  return {
    track: input.track,
    status: {
      key,
      label,
      tone: key === "failed" || key === "integrity-failed"
        ? "danger"
        : key === "assembling" || key === "finalizing"
          ? "success"
          : key === "paused" || key === "waiting"
            ? "warning"
            : "neutral"
    },
    category: "active",
    detail,
    progress,
    speedLabel: isDownloading ? formatDownloadRate(input.task?.downloadRateKbps) : null,
    aheadLabel: isDownloading ? formatAhead(input.task?.activeAheadMs) : null,
    action,
    actionDisabled
  };
}

export function filterRoomCacheRows(rows: RoomCacheRow[], filter: RoomCacheFilter) {
  return filter === "all" ? rows : rows.filter((row) => row.category === filter);
}

export function formatCacheSize(sizeBytes: number | null | undefined) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }
  if (sizeBytes >= 1024 * 1024 * 1024) {
    return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${Math.round(sizeBytes)} B`;
}

export function formatCachedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "时间未知";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function isCachedTrackInRoomLibrary(input: {
  fileHash: string;
  activeSessionUserId: string | null | undefined;
  tracks: Array<Pick<TrackMeta, "fileHash" | "ownerSessionId">>;
}) {
  return !!input.activeSessionUserId && input.tracks.some(
    (track) => track.fileHash === input.fileHash && track.ownerSessionId === input.activeSessionUserId
  );
}
