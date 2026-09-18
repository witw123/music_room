import { apiBaseUrl } from "./api-client";
import { importBandwidthGovernor } from "./import-bandwidth-governor";
import {
  errorCodes,
  type ApiErrorResponse,
  type PlaybackSnapshot,
  type ProviderAudioResolveResponse,
  type QueueItem,
  type RoomType
} from "@music-room/shared";

export class MusicRoomApiError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorResponse["code"] | null,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export type QueueMutationResponse = {
  queue: QueueItem[];
  playback: PlaybackSnapshot;
};

export type RadioAutopilotNextTrackMutationResponse = QueueMutationResponse & {
  insertedQueueItemId: string;
};

export type RoomActivitySummary = {
  roomId: string;
  roomName: string;
  joinCode: string;
  durationMs: number;
  lastJoinedAt: string;
  isActive: boolean;
  roomType: RoomType;
};

export type RoomInteractionStats = {
  sentLikes: number;
  sentApplause: number;
  receivedReactions: number;
};

export type AuthConfig = {
  enabled: boolean;
  siteKey: string;
};

export const playlistsChangedEventName = "music-room-playlists-changed";
export const playlistsChangedStorageKey = "music-room-playlists-version";

let playlistsChangeSequence = 0;

export function notifyPlaylistsChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(playlistsChangedEventName));
  try {
    window.localStorage.setItem(
      playlistsChangedStorageKey,
      `${Date.now()}-${++playlistsChangeSequence}`
    );
  } catch {
    // The same-tab event still keeps the current page in sync when storage is unavailable.
  }
}

export function extractApiErrorMessage(rawBody: string) {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown } | string;
    if (typeof parsed === "string") {
      return parsed;
    }

    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }

    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Fall back to the raw response body when the backend returns plain text.
  }

  return trimmed;
}

export function extractApiError(rawBody: string): ApiErrorResponse | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<ApiErrorResponse>;
    if (typeof parsed.code === "string" && typeof parsed.message === "string") {
      return {
        code: parsed.code as ApiErrorResponse["code"],
        message: parsed.message,
        details: parsed.details
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { notifyAuthExpired?: boolean }
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    const rawErrorBody = await response.text();
    const apiError = extractApiError(rawErrorBody);
    const message = apiError?.message ?? extractApiErrorMessage(rawErrorBody);
    const shouldExpireSession =
      response.status === 401 &&
      apiError?.code === errorCodes.unauthorized &&
      options?.notifyAuthExpired !== false &&
      typeof window !== "undefined";
    if (shouldExpireSession) {
      window.dispatchEvent(
        new CustomEvent("music-room-auth-expired", {
          detail: { message }
        })
      );
    }
    throw new MusicRoomApiError(
      message || `Request failed: ${response.status}`,
      apiError?.code ?? null,
      apiError?.details
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return null as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody) as T;
  }

  return rawBody as T;
}

export async function requestBlob(
  path: string,
  init?: RequestInit,
  options?: { throttleImport?: boolean }
) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    ...(options?.throttleImport ? { priority: "low" as const } : {}),
    headers: {
      ...(init?.headers ?? {})
    },
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    const rawErrorBody = await response.text();
    const apiError = extractApiError(rawErrorBody);
    const message = apiError?.message ?? extractApiErrorMessage(rawErrorBody);
    if (
      response.status === 401 &&
      apiError?.code === errorCodes.unauthorized &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("music-room-auth-expired", {
          detail: { message }
        })
      );
    }
    throw new MusicRoomApiError(
      message || `Request failed: ${response.status}`,
      apiError?.code ?? null,
      apiError?.details
    );
  }

  return {
    blob: options?.throttleImport
      ? await importBandwidthGovernor.readResponse(response, init?.signal ?? undefined)
      : await response.blob(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream"
  };
}

export type DirectAudioResolveResult = {
  url: string;
  urls?: string[];
  mimeType?: string | null;
  fileType?: string;
  provider?: string;
  providerTrackId?: string;
};

export async function resolveDownloadedAudioMimeType(blob: Blob, declaredType: string) {
  if (blob.size <= 0) {
    throw new Error("下载到的音频为空，请稍后重试。");
  }

  const normalizedDeclaredType = declaredType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    normalizedDeclaredType === "application/json" ||
    normalizedDeclaredType === "text/html" ||
    normalizedDeclaredType.startsWith("text/")
  ) {
    throw new Error("音乐平台返回了错误信息，未获得可播放音频。");
  }

  const probe = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer()
  );
  if (
    probe.length >= 4 &&
    probe[0] === 0x66 &&
    probe[1] === 0x4c &&
    probe[2] === 0x61 &&
    probe[3] === 0x43
  ) {
    return "audio/flac";
  }

  if (
    probe.length >= 12 &&
    probe[0] === 0x52 &&
    probe[1] === 0x49 &&
    probe[2] === 0x46 &&
    probe[3] === 0x46 &&
    probe[8] === 0x57 &&
    probe[9] === 0x41 &&
    probe[10] === 0x56 &&
    probe[11] === 0x45
  ) {
    return "audio/wav";
  }

  if (
    probe.length >= 3 &&
    probe[0] === 0x49 &&
    probe[1] === 0x44 &&
    probe[2] === 0x33
  ) {
    return "audio/mpeg";
  }

  // MP4 / M4A / AAC container (ftyp box at byte 4..7)
  if (
    probe.length >= 8 &&
    probe[4] === 0x66 &&
    probe[5] === 0x74 &&
    probe[6] === 0x79 &&
    probe[7] === 0x70
  ) {
    return "audio/mp4";
  }

  // AAC ADTS syncword (0xfff)
  if (probe.length >= 2 && probe[0] === 0xff && (probe[1]! & 0xf0) === 0xf0) {
    return "audio/mp4";
  }

  for (let index = 0; index + 2 < probe.length; index += 1) {
    if (probe[index] !== 0xff || (probe[index + 1]! & 0xe0) !== 0xe0) {
      continue;
    }
    const layer = (probe[index + 1]! >> 1) & 0x03;
    const bitrateIndex = (probe[index + 2]! >> 4) & 0x0f;
    const sampleRateIndex = (probe[index + 2]! >> 2) & 0x03;
    if (layer !== 0 && bitrateIndex !== 0 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03) {
      return "audio/mpeg";
    }
  }

  if (
    normalizedDeclaredType === "audio/mp4" ||
    normalizedDeclaredType === "video/mp4" ||
    normalizedDeclaredType === "audio/aac" ||
    normalizedDeclaredType === "audio/x-m4a"
  ) {
    return "audio/mp4";
  }

  if (normalizedDeclaredType.startsWith("audio/")) {
    return normalizedDeclaredType;
  }

  throw new Error("下载内容不是有效的音频，请重试或更换音质。");
}

const DIRECT_PROBE_TIMEOUT_MS = 5000;
const DIRECT_DOWNLOAD_HEADER_TIMEOUT_MS = 8000;
const DIRECT_CANDIDATE_LIMIT = 6;
const DIRECT_PARALLEL_RANGE_THRESHOLD_BYTES = 2 * 1024 * 1024;
const DIRECT_PARALLEL_RANGE_MAX_BYTES = 512 * 1024 * 1024;
const DIRECT_PARALLEL_RANGE_PARTS = 4;

type DirectCandidateProbeResult = {
  url: string;
  ok: boolean;
  contentType: string | null;
  contentLength: number | null;
  acceptsRanges: boolean;
  elapsedMs: number;
};

function upgradeDirectUrl(url: string) {
  return url.startsWith("http://") ? url.replace(/^http:\/\//i, "https://") : url;
}

function buildDirectFetchInit(signal: AbortSignal, headers?: Record<string, string>): RequestInit {
  return {
    signal,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    ...(headers ? { headers } : {})
  };
}

/**
 * 以“仅到响应头”的轻量请求探测候选 CDN 直链（参考 bili-music 的候选探测策略）：
 * 拿到响应头后立即取消响应体，探测只关心该候选能否快速应答，
 * 落选候选不会消耗任何字节流量。
 */
async function probeDirectCandidate(
  directUrl: string,
  outerSignal?: AbortSignal
): Promise<DirectCandidateProbeResult> {
  const startedAt = Date.now();
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), DIRECT_PROBE_TIMEOUT_MS);
  const abortHandler = () => timeoutCtrl.abort();
  outerSignal?.addEventListener("abort", abortHandler, { once: true });
  try {
    const response = await fetch(directUrl, buildDirectFetchInit(timeoutCtrl.signal));
    const contentType = response.headers.get("content-type");
    const contentLengthRaw = Number(response.headers.get("content-length"));
    const acceptsRanges = (response.headers.get("accept-ranges") ?? "").toLowerCase().includes("bytes");
    void response.body?.cancel().catch(() => undefined);
    return {
      url: directUrl,
      ok: response.ok,
      contentType,
      contentLength: Number.isFinite(contentLengthRaw) && contentLengthRaw > 0 ? contentLengthRaw : null,
      acceptsRanges,
      elapsedMs: Date.now() - startedAt
    };
  } catch {
    return {
      url: directUrl,
      ok: false,
      contentType: null,
      contentLength: null,
      acceptsRanges: false,
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", abortHandler);
  }
}

/**
 * 并发探测所有候选，任一健康候选应答立即胜出（内容相同，取最快者），
 * 避免旧实现按串行逐个等待 4 秒超时。探测 Promise 不会 reject。
 */
function resolveFirstHealthyProbe(
  probes: Promise<DirectCandidateProbeResult>[]
): Promise<DirectCandidateProbeResult | null> {
  return new Promise((resolve) => {
    if (probes.length === 0) {
      resolve(null);
      return;
    }
    let settledCount = 0;
    let winnerChosen = false;
    for (const probe of probes) {
      void probe.then((result) => {
        settledCount += 1;
        if (result.ok && !winnerChosen) {
          winnerChosen = true;
          resolve(result);
          return;
        }
        if (settledCount === probes.length && !winnerChosen) {
          resolve(null);
        }
      });
    }
  });
}

async function fetchDirectWithHeaderTimeout(
  directUrl: string,
  outerSignal: AbortSignal | undefined,
  headers?: Record<string, string>
): Promise<Response> {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), DIRECT_DOWNLOAD_HEADER_TIMEOUT_MS);
  const abortHandler = () => timeoutCtrl.abort();
  outerSignal?.addEventListener("abort", abortHandler, { once: true });
  try {
    return await fetch(directUrl, buildDirectFetchInit(timeoutCtrl.signal, headers));
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", abortHandler);
  }
}

async function downloadDirectBlob(directUrl: string, outerSignal?: AbortSignal): Promise<Blob> {
  const response = await fetchDirectWithHeaderTimeout(directUrl, outerSignal);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`CDN 直链返回 HTTP ${response.status}`);
  }
  // 响应头已到达，此处不再有下载总时长限制（仅受外部 signal 约束）。
  return response.blob();
}

/**
 * 对支持 Range 的大文件并发拉取多个分段后拼装，绕开单连接限速。
 * 任一分段失败或长度不符时返回 null，由调用方回退到整包下载。
 */
async function downloadDirectBlobInParallelRanges(
  directUrl: string,
  contentLength: number,
  outerSignal?: AbortSignal
): Promise<Blob | null> {
  const partSize = Math.ceil(contentLength / DIRECT_PARALLEL_RANGE_PARTS);
  try {
    const parts = await Promise.all(
      Array.from({ length: DIRECT_PARALLEL_RANGE_PARTS }, (_, index) => {
        const start = index * partSize;
        const end = Math.min(contentLength - 1, start + partSize - 1);
        const expectedSize = end - start + 1;
        return fetchDirectWithHeaderTimeout(directUrl, outerSignal, {
          Range: `bytes=${start}-${end}`
        }).then(async (response) => {
          if (response.status !== 206) {
            // 服务器忽略 Range 返回 200 整包时立即放弃，避免重复下载整文件。
            void response.body?.cancel().catch(() => undefined);
            throw new Error(`CDN 分段请求返回 HTTP ${response.status}`);
          }
          const part = await response.blob();
          if (part.size !== expectedSize) {
            throw new Error(`CDN 分段长度不符：${part.size} != ${expectedSize}`);
          }
          return part;
        });
      })
    );
    return new Blob(parts);
  } catch {
    return null;
  }
}

export async function downloadWithDirectFallback(input: {
  resolve: () => Promise<ProviderAudioResolveResponse | DirectAudioResolveResult>;
  fallback: () => Promise<{ blob: Blob; contentType: string }>;
  signal?: AbortSignal;
}) {
  try {
    const resolved = await input.resolve();
    const candidateUrls = Array.isArray((resolved as { urls?: string[] }).urls) && (resolved as { urls: string[] }).urls.length > 0
      ? (resolved as { urls: string[] }).urls
      : [resolved.url];
    if (input.signal?.aborted) throw new Error("Download aborted");

    const candidates = candidateUrls
      .slice(0, DIRECT_CANDIDATE_LIMIT)
      .map(upgradeDirectUrl);
    const winner = await resolveFirstHealthyProbe(
      candidates.map((candidateUrl) => probeDirectCandidate(candidateUrl, input.signal))
    );

    if (winner) {
      let blob: Blob | null = null;
      if (
        winner.acceptsRanges &&
        winner.contentLength &&
        winner.contentLength >= DIRECT_PARALLEL_RANGE_THRESHOLD_BYTES &&
        winner.contentLength <= DIRECT_PARALLEL_RANGE_MAX_BYTES
      ) {
        blob = await downloadDirectBlobInParallelRanges(winner.url, winner.contentLength, input.signal);
      }
      if (!blob && !input.signal?.aborted) {
        blob = await downloadDirectBlob(winner.url, input.signal);
      }
      if (input.signal?.aborted) throw new Error("Download aborted");
      if (blob && blob.size > 0) {
        const contentType = await resolveDownloadedAudioMimeType(
          blob,
          winner.contentType ?? resolved.mimeType ?? ""
        );
        return { blob, contentType };
      }
    }
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
  }

  const fallback = await input.fallback();
  return {
    ...fallback,
    contentType: await resolveDownloadedAudioMimeType(
      fallback.blob,
      fallback.contentType
    )
  };
}
