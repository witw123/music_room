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

export const peerSignalMessageSchema = z.object({
  roomId: z.string(),
  fromPeerId: z.string(),
  toPeerId: z.string(),
  type: z.enum(["offer", "answer", "candidate"]),
  payload: z.record(z.unknown())
});

export type TrackPieceInfo = z.infer<typeof trackPieceInfoSchema>;
export type TrackAvailability = z.infer<typeof trackAvailabilitySchema>;
export type PeerSignalMessage = z.infer<typeof peerSignalMessageSchema>;

