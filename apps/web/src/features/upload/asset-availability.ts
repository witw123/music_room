import type {
  AssetAvailabilityAnnouncement,
  OriginalAssetManifest,
  PlaybackAssetManifest
} from "@music-room/shared";

export function buildCompleteAssetAnnouncements(input: {
  roomId: string;
  peerId: string;
  nickname: string;
  source: "live_upload" | "local_cache";
  originalAsset: OriginalAssetManifest;
  playbackAsset: PlaybackAssetManifest;
  announcedAt?: string;
}): AssetAvailabilityAnnouncement[] {
  const announcedAt = input.announcedAt ?? new Date().toISOString();
  return [input.playbackAsset, input.originalAsset].map((asset) => ({
    protocolVersion: 4 as const,
    roomId: input.roomId,
    assetId: asset.assetId,
    assetKind: asset.kind,
    ownerPeerId: input.peerId,
    nickname: input.nickname,
    totalUnits: asset.unitCount,
    availableRanges: [{ start: 0, end: asset.unitCount - 1 }],
    complete: true,
    source: input.source,
    announcedAt
  }));
}
