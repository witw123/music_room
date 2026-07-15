export type AssetTransferWindowManifest = {
  durationMs: number;
  totalChunks: number;
  chunkSize: number;
};

export function chunkIndexForPlaybackPosition(
  manifest: Pick<AssetTransferWindowManifest, "durationMs" | "totalChunks">,
  playbackPositionMs: number
) {
  if (manifest.durationMs <= 0 || manifest.totalChunks <= 0) {
    return 0;
  }

  const ratio = Math.max(0, playbackPositionMs) / manifest.durationMs;
  return Math.min(
    manifest.totalChunks - 1,
    Math.max(0, Math.floor(ratio * manifest.totalChunks))
  );
}

export function getRequiredDecodablePrefixChunkCount(input: {
  manifest: Pick<AssetTransferWindowManifest, "durationMs" | "totalChunks">;
  playbackPositionMs: number;
  lookAheadMs: number;
}) {
  if (input.manifest.durationMs <= 0 || input.manifest.totalChunks <= 0) {
    return 0;
  }

  const prefixEndPositionMs = Math.min(
    input.manifest.durationMs,
    Math.max(0, input.playbackPositionMs) + Math.max(0, input.lookAheadMs)
  );
  return Math.min(
    input.manifest.totalChunks,
    chunkIndexForPlaybackPosition(input.manifest, prefixEndPositionMs) + 1
  );
}

export function resolveAssetChunkOrder(input: {
  manifest: AssetTransferWindowManifest;
  playbackPositionMs: number;
  availableChunks: number[];
  pendingChunks?: number[];
  lookBehindMs?: number;
  startupLookAheadMs?: number;
  steadyLookAheadMs?: number;
  requiredLeadingChunkCount?: number;
  limit?: number;
}) {
  const { manifest } = input;
  if (manifest.totalChunks <= 0 || manifest.durationMs <= 0) {
    return [];
  }

  const owned = new Set(input.availableChunks);
  const pending = new Set(input.pendingChunks ?? []);
  const seen = new Set<number>();
  const result: number[] = [];
  const limit = Math.max(0, input.limit ?? manifest.totalChunks);
  const current = chunkIndexForPlaybackPosition(manifest, input.playbackPositionMs);
  const lookBehindMs = Math.max(0, input.lookBehindMs ?? 2_000);
  const startupLookAheadMs = Math.max(0, input.startupLookAheadMs ?? 8_000);
  const steadyLookAheadMs = Math.max(startupLookAheadMs, input.steadyLookAheadMs ?? 30_000);
  const behindStart = chunkIndexForPlaybackPosition(
    manifest,
    Math.max(0, input.playbackPositionMs - lookBehindMs)
  );
  const startupEnd = chunkIndexForPlaybackPosition(
    manifest,
    Math.min(manifest.durationMs, input.playbackPositionMs + startupLookAheadMs)
  );
  const steadyEnd = chunkIndexForPlaybackPosition(
    manifest,
    Math.min(manifest.durationMs, input.playbackPositionMs + steadyLookAheadMs)
  );
  const requiredLeadingChunkCount = Math.min(
    manifest.totalChunks,
    Math.max(0, input.requiredLeadingChunkCount ?? 0)
  );

  appendMissing(result, { owned, pending, seen, limit }, 0, requiredLeadingChunkCount - 1, 1);
  appendMissing(result, { owned, pending, seen, limit }, behindStart, current - 1, 1);
  appendMissing(result, { owned, pending, seen, limit }, current, startupEnd, 1);
  appendMissing(result, { owned, pending, seen, limit }, startupEnd + 1, steadyEnd, 1);
  appendMissing(result, { owned, pending, seen, limit }, steadyEnd + 1, manifest.totalChunks - 1, 1);
  appendMissing(result, { owned, pending, seen, limit }, behindStart - 1, 0, -1);

  return result;
}

function appendMissing(
  target: number[],
  state: {
    owned: Set<number>;
    pending: Set<number>;
    seen: Set<number>;
    limit: number;
  },
  from: number,
  to: number,
  step: 1 | -1
) {
  if (state.limit <= 0 || target.length >= state.limit) {
    return;
  }

  if (step === 1) {
    for (let chunkIndex = from; chunkIndex <= to; chunkIndex += 1) {
      appendOne(target, state, chunkIndex);
      if (target.length >= state.limit) {
        return;
      }
    }
    return;
  }

  for (let chunkIndex = from; chunkIndex >= to; chunkIndex -= 1) {
    appendOne(target, state, chunkIndex);
    if (target.length >= state.limit) {
      return;
    }
  }
}

function appendOne(
  target: number[],
  state: {
    owned: Set<number>;
    pending: Set<number>;
    seen: Set<number>;
  },
  chunkIndex: number
) {
  if (
    chunkIndex < 0 ||
    state.owned.has(chunkIndex) ||
    state.pending.has(chunkIndex) ||
    state.seen.has(chunkIndex)
  ) {
    return;
  }

  state.seen.add(chunkIndex);
  target.push(chunkIndex);
}
