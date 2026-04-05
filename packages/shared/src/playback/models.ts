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

export type PlaybackSnapshot = z.infer<typeof playbackSnapshotSchema>;
