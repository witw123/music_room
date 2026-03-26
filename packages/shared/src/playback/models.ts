import { z } from "zod";

export const playbackSnapshotSchema = z.object({
  status: z.enum(["playing", "paused", "buffering"]),
  currentTrackId: z.string().nullable(),
  positionMs: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  queueVersion: z.number().int().positive()
});

export type PlaybackSnapshot = z.infer<typeof playbackSnapshotSchema>;

