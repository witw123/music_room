import type { PlaybackAssetManifest } from "@music-room/shared";

export function playbackUnitIndexAt(
  manifest: Pick<PlaybackAssetManifest, "segmentDurationMs" | "unitCount">,
  positionMs: number
) {
  return Math.min(
    manifest.unitCount - 1,
    Math.max(0, Math.floor(Math.max(0, positionMs) / manifest.segmentDurationMs))
  );
}

export function resolvePlaybackUnitOrder(input: {
  manifest: Pick<PlaybackAssetManifest, "segmentDurationMs" | "unitCount">;
  positionMs: number;
  ownedUnitIndexes: readonly number[];
  requestLimit?: number;
}) {
  const current = playbackUnitIndexAt(input.manifest, input.positionMs);
  const owned = new Set(input.ownedUnitIndexes);
  const order: number[] = [];
  const append = (from: number, to: number) => {
    for (let index = Math.max(0, from); index <= Math.min(input.manifest.unitCount - 1, to); index += 1) {
      if (!owned.has(index) && !order.includes(index)) {
        order.push(index);
      }
    }
  };
  append(current, current + Math.ceil(10_000 / input.manifest.segmentDurationMs));
  append(current + Math.ceil(10_000 / input.manifest.segmentDurationMs) + 1, current + Math.ceil(30_000 / input.manifest.segmentDurationMs));
  append(current + Math.ceil(30_000 / input.manifest.segmentDurationMs) + 1, input.manifest.unitCount - 1);
  append(0, current - 1);
  return order.slice(0, input.requestLimit ?? order.length);
}

export function contiguousPlaybackBufferMs(input: {
  manifest: Pick<PlaybackAssetManifest, "segmentDurationMs" | "unitCount" | "durationMs">;
  positionMs: number;
  ownedUnitIndexes: readonly number[];
}) {
  const current = playbackUnitIndexAt(input.manifest, input.positionMs);
  const owned = new Set(input.ownedUnitIndexes);
  let endExclusive = current;
  while (endExclusive < input.manifest.unitCount && owned.has(endExclusive)) {
    endExclusive += 1;
  }
  const bufferedEndMs = Math.min(
    input.manifest.durationMs,
    endExclusive * input.manifest.segmentDurationMs
  );
  return Math.max(0, bufferedEndMs - input.positionMs);
}

export function resolveStartupUnitIndexes(input: {
  manifest: Pick<PlaybackAssetManifest, "segmentDurationMs" | "unitCount">;
  positionMs: number;
}) {
  const current = playbackUnitIndexAt(input.manifest, input.positionMs);
  return [current];
}
