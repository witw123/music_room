import { z } from "zod";
import { peerSignalMessageSchema } from "../p2p/models";
import { playbackSnapshotSchema } from "../playback/models";
import { roomSchema } from "../room/models";

export const websocketEventSchema = z.union([
  z.literal("room.join"),
  z.literal("room.snapshot"),
  z.literal("queue.update"),
  z.literal("playback.update"),
  z.literal("track.announce"),
  z.literal("piece.availability"),
  z.literal("peer.signal")
]);

export const roomSnapshotMessageSchema = z.object({
  event: z.literal("room.snapshot"),
  payload: roomSchema
});

export const playbackUpdateMessageSchema = z.object({
  event: z.literal("playback.update"),
  payload: playbackSnapshotSchema
});

export const peerSignalEventSchema = z.object({
  event: z.literal("peer.signal"),
  payload: peerSignalMessageSchema
});

export type WebsocketEvent = z.infer<typeof websocketEventSchema>;

