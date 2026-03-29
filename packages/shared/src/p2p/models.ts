import { z } from "zod";

export const trackPieceInfoSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  hash: z.string(),
  ownerPeerId: z.string()
});

export const trackAvailabilitySchema = z.object({
  trackId: z.string(),
  ownerPeerId: z.string(),
  availableChunks: z.array(z.number().int().nonnegative()),
  announcedAt: z.string().datetime()
});

export const trackAvailabilityAnnouncementSchema = z.object({
  roomId: z.string(),
  trackId: z.string(),
  ownerPeerId: z.string(),
  nickname: z.string(),
  totalChunks: z.number().int().nonnegative(),
  availableChunks: z.array(z.number().int().nonnegative()),
  source: z.enum(["live_upload", "local_cache"]),
  announcedAt: z.string().datetime()
});

export const peerSignalMessageSchema = z.object({
  roomId: z.string(),
  fromPeerId: z.string(),
  toPeerId: z.string(),
  type: z.enum(["offer", "answer", "candidate"]),
  payload: z.record(z.unknown())
});

export const p2pDataMessageSchema = z.union([
  z.object({
    kind: z.literal("request-piece"),
    trackId: z.string(),
    chunkIndex: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal("send-piece"),
    trackId: z.string(),
    chunkIndex: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive(),
    mimeType: z.string(),
    pieceHash: z.string(),
    payloadBase64: z.string()
  })
]);

export type TrackPieceInfo = z.infer<typeof trackPieceInfoSchema>;
export type TrackAvailability = z.infer<typeof trackAvailabilitySchema>;
export type TrackAvailabilityAnnouncement = z.infer<typeof trackAvailabilityAnnouncementSchema>;
export type PeerSignalMessage = z.infer<typeof peerSignalMessageSchema>;
export type P2PDataMessage = z.infer<typeof p2pDataMessageSchema>;
