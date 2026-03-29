import { z } from "zod";
import {
  p2pDataMessageSchema,
  peerSignalMessageSchema,
  trackAvailabilityAnnouncementSchema
} from "../p2p/models";
import { roomSnapshotSchema } from "../room/models";

export const websocketEventSchema = z.union([
  z.literal("room.subscribe"),
  z.literal("room.presence"),
  z.literal("room.unsubscribe"),
  z.literal("room.snapshot"),
  z.literal("room.snapshot.missing"),
  z.literal("piece.availability"),
  z.literal("peer.signal")
]);

export const roomSubscribePayloadSchema = z.object({
  roomId: z.string(),
  sessionId: z.string().optional(),
  peerId: z.string().optional()
});

export const roomUnsubscribePayloadSchema = z.object({
  roomId: z.string()
});

export const roomPresencePayloadSchema = z.object({
  roomId: z.string(),
  sessionId: z.string(),
  peerId: z.string()
});

export const roomSnapshotMissingPayloadSchema = z.object({
  roomId: z.string()
});

export const roomSnapshotEventSchema = z.object({
  event: z.literal("room.snapshot"),
  payload: roomSnapshotSchema
});

export const roomSnapshotMissingEventSchema = z.object({
  event: z.literal("room.snapshot.missing"),
  payload: roomSnapshotMissingPayloadSchema
});

export const peerSignalEventSchema = z.object({
  event: z.literal("peer.signal"),
  payload: peerSignalMessageSchema
});

export const pieceAvailabilityEventSchema = z.object({
  event: z.literal("piece.availability"),
  payload: trackAvailabilityAnnouncementSchema
});

export type WebsocketEvent = z.infer<typeof websocketEventSchema>;
export type RoomSubscribePayload = z.infer<typeof roomSubscribePayloadSchema>;
export type RoomUnsubscribePayload = z.infer<typeof roomUnsubscribePayloadSchema>;
export type RoomPresencePayload = z.infer<typeof roomPresencePayloadSchema>;
export type RoomSnapshotMissingPayload = z.infer<typeof roomSnapshotMissingPayloadSchema>;
export type P2PDataMessagePayload = z.infer<typeof p2pDataMessageSchema>;

export type ServerToClientEvents = {
  "room.snapshot": (snapshot: z.infer<typeof roomSnapshotSchema>) => void;
  "room.snapshot.missing": (payload: RoomSnapshotMissingPayload) => void;
  "piece.availability": (payload: z.infer<typeof trackAvailabilityAnnouncementSchema>) => void;
  "peer.signal": (payload: z.infer<typeof peerSignalMessageSchema>) => void;
  connect: () => void;
  disconnect: () => void;
};

export type ClientToServerEvents = {
  "room.subscribe": (payload: RoomSubscribePayload) => void;
  "room.presence": (payload: RoomPresencePayload) => void;
  "room.unsubscribe": (payload: RoomUnsubscribePayload) => void;
  "piece.availability": (payload: z.infer<typeof trackAvailabilityAnnouncementSchema>) => void;
  "peer.signal": (payload: z.infer<typeof peerSignalMessageSchema>) => void;
};
