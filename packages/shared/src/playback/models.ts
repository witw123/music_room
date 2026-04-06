import { z } from "zod";

export const playbackSnapshotSchema = z.object({
  status: z.enum(["playing", "paused", "buffering"]),
  currentTrackId: z.string().nullable(),
  currentQueueItemId: z.string().nullable(),
  sourceSessionId: z.string().nullable(),
  sourcePeerId: z.string().nullable(),
  sourceTrackId: z.string().nullable(),
  positionMs: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  queueVersion: z.number().int().positive(),
  playbackRevision: z.number().int().positive().default(1),
  mediaEpoch: z.number().int().nonnegative()
});

export const roomMediaClockPayloadSchema = z.object({
  roomId: z.string(),
  mediaEpoch: z.number().int().nonnegative(),
  sourcePeerId: z.string(),
  relayGeneration: z.number().int().nonnegative(),
  mediaTimeMs: z.number().int().nonnegative(),
  playbackRate: z.number().positive(),
  advancing: z.boolean(),
  playoutState: z.enum(["playing", "buffering", "paused"]),
  bufferedAheadMs: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  emittedAt: z.string().datetime()
});

export type PlaybackSnapshot = z.infer<typeof playbackSnapshotSchema>;
export type RoomMediaClockPayload = z.infer<typeof roomMediaClockPayloadSchema>;
