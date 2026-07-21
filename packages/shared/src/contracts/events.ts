import { z } from "zod";
import { peerSignalMessageSchema } from "../p2p/models";
import { p2pProtocolVersion, segmentedOpusCapability } from "../p2p/asset-models";
import { roomSnapshotSchema, roomTrackDeletionSchema } from "../room/models";
import { playbackSnapshotSchema } from "../playback/models";
import { queueItemSchema, trackMetaSchema } from "../playlist/models";
import { telemetryReportSchema, type TelemetryReport } from "./telemetry";

export const websocketEventSchema = z.union([
  z.literal("room.subscribe"),
  z.literal("room.presence"),
  z.literal("room.unsubscribe"),
  z.literal("room.snapshot"),
  z.literal("room.snapshot.missing"),
  z.literal("room.deleted"),
  z.literal("room.playback.patch"),
  z.literal("room.queue.patch"),
  z.literal("room.presence.patch"),
  z.literal("room.library.patch"),
  z.literal("room.track.deleted"),
  z.literal("room.session.replaced"),
  z.literal("peer.signal"),
  z.literal("room.chat"),
  z.literal("diagnostics.report"),
  z.literal("session.revoked")
]);

export const diagnosticsReportPayloadSchema = telemetryReportSchema;

export const roomSubscribePayloadSchema = z.object({
  roomId: z.string(),
  sessionId: z.string().optional(),
  peerId: z.string().optional(),
  protocolVersion: z.number().int().nonnegative().optional(),
  capabilities: z.array(z.string().min(1).max(120)).max(20).optional(),
  buildId: z.string().min(1).max(160).optional()
});

export const roomSubscribeBootstrapMemberSchema = z.object({
  id: z.string(),
  peerId: z.string().nullable(),
  presenceState: roomSnapshotSchema.shape.room.shape.members.element.shape.presenceState,
  role: roomSnapshotSchema.shape.room.shape.members.element.shape.role
});

export const roomSubscribeAckPayloadSchema = z.object({
  ok: z.boolean(),
  protocolVersion: z.literal(p2pProtocolVersion).optional(),
  capability: z.literal(segmentedOpusCapability).optional(),
  errorCode: z.literal("client_upgrade_required").optional(),
  serverNow: z.string().datetime().optional(),
  recoveryGeneration: z.number().int().nonnegative().optional(),
  bootstrap: z
    .object({
      roomId: z.string(),
      roomRevision: z.number().int().nonnegative(),
      presenceRevision: z.number().int().nonnegative(),
      playback: playbackSnapshotSchema,
      members: z.array(roomSubscribeBootstrapMemberSchema)
    })
    .optional()
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

export const roomDeletedPayloadSchema = z.object({
  roomId: z.string(),
  trackIds: z.array(z.string())
});

export const roomSessionReplacedPayloadSchema = z.object({
  roomId: z.string(),
  reason: z.literal("duplicate-session")
});

export const roomPlaybackPatchPayloadSchema = z.object({
  roomId: z.string(),
  playback: playbackSnapshotSchema,
  updatedAt: z.string().datetime()
});

export const roomQueuePatchPayloadSchema = z.object({
  roomId: z.string(),
  queue: z.array(queueItemSchema),
  playback: playbackSnapshotSchema,
  roomRevision: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime()
});

export const roomPresencePatchPayloadSchema = z.object({
  roomId: z.string(),
  members: roomSnapshotSchema.shape.room.shape.members,
  playback: playbackSnapshotSchema,
  presenceRevision: z.number().int().nonnegative(),
  roomRevision: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime()
});

export const roomLibraryPatchPayloadSchema = z.object({
  roomId: z.string(),
  tracks: z.array(trackMetaSchema),
  queue: z.array(queueItemSchema),
  playback: playbackSnapshotSchema,
  roomRevision: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime()
});

export const roomTrackDeletedPayloadSchema = roomTrackDeletionSchema.extend({
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

export const roomDeletedEventSchema = z.object({
  event: z.literal("room.deleted"),
  payload: roomDeletedPayloadSchema
});

export const roomSessionReplacedEventSchema = z.object({
  event: z.literal("room.session.replaced"),
  payload: roomSessionReplacedPayloadSchema
});

export const roomPlaybackPatchEventSchema = z.object({
  event: z.literal("room.playback.patch"),
  payload: roomPlaybackPatchPayloadSchema
});

export const roomQueuePatchEventSchema = z.object({
  event: z.literal("room.queue.patch"),
  payload: roomQueuePatchPayloadSchema
});

export const roomPresencePatchEventSchema = z.object({
  event: z.literal("room.presence.patch"),
  payload: roomPresencePatchPayloadSchema
});

export const roomLibraryPatchEventSchema = z.object({
  event: z.literal("room.library.patch"),
  payload: roomLibraryPatchPayloadSchema
});

export const roomTrackDeletedEventSchema = z.object({
  event: z.literal("room.track.deleted"),
  payload: roomTrackDeletedPayloadSchema
});

export const peerSignalEventSchema = z.object({
  event: z.literal("peer.signal"),
  payload: peerSignalMessageSchema
});

export const roomChatPayloadSchema = z.object({
  roomId: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  content: z.string(),
  timestamp: z.number().optional()
});

export const roomChatInputPayloadSchema = z
  .object({
    roomId: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(500),
    timestamp: z.number().int().nonnegative().optional()
  })
  .strict();

export const roomChatEventSchema = z.object({
  event: z.literal("room.chat"),
  payload: roomChatPayloadSchema
});

export type WebsocketEvent = z.infer<typeof websocketEventSchema>;
export type RoomSubscribePayload = z.infer<typeof roomSubscribePayloadSchema>;
export type RoomSubscribeBootstrapMember = z.infer<typeof roomSubscribeBootstrapMemberSchema>;
export type RoomSubscribeAckPayload = z.infer<typeof roomSubscribeAckPayloadSchema>;
export type RoomUnsubscribePayload = z.infer<typeof roomUnsubscribePayloadSchema>;
export type RoomPresencePayload = z.infer<typeof roomPresencePayloadSchema>;
export type RoomSnapshotMissingPayload = z.infer<typeof roomSnapshotMissingPayloadSchema>;
export type RoomDeletedPayload = z.infer<typeof roomDeletedPayloadSchema>;
export type RoomSessionReplacedPayload = z.infer<typeof roomSessionReplacedPayloadSchema>;
export type RoomPlaybackPatchPayload = z.infer<typeof roomPlaybackPatchPayloadSchema>;
export type RoomQueuePatchPayload = z.infer<typeof roomQueuePatchPayloadSchema>;
export type RoomPresencePatchPayload = z.infer<typeof roomPresencePatchPayloadSchema>;
export type RoomLibraryPatchPayload = z.infer<typeof roomLibraryPatchPayloadSchema>;
export type RoomTrackDeletedPayload = z.infer<typeof roomTrackDeletedPayloadSchema>;
export type RoomChatPayload = z.infer<typeof roomChatPayloadSchema>;
export type RoomChatInputPayload = z.infer<typeof roomChatInputPayloadSchema>;
export type DiagnosticsReportPayload = TelemetryReport;

export type ServerToClientEvents = {
  "room.snapshot": (snapshot: z.infer<typeof roomSnapshotSchema>) => void;
  "room.snapshot.missing": (payload: RoomSnapshotMissingPayload) => void;
  "room.deleted": (payload: RoomDeletedPayload) => void;
  "room.session.replaced": (payload: RoomSessionReplacedPayload) => void;
  "room.playback.patch": (payload: RoomPlaybackPatchPayload) => void;
  "room.queue.patch": (payload: RoomQueuePatchPayload) => void;
  "room.presence.patch": (payload: RoomPresencePatchPayload) => void;
  "room.library.patch": (payload: RoomLibraryPatchPayload) => void;
  "room.track.deleted": (payload: RoomTrackDeletedPayload) => void;
  "peer.signal": (payload: z.infer<typeof peerSignalMessageSchema>) => void;
  "room.chat": (payload: RoomChatPayload) => void;
  "session.revoked": () => void;
  connect: () => void;
  disconnect: () => void;
};

export type ClientToServerEvents = {
  "room.subscribe": (
    payload: RoomSubscribePayload,
    ack?: (payload: RoomSubscribeAckPayload) => void
  ) => void;
  "room.presence": (payload: RoomPresencePayload) => void;
  "room.unsubscribe": (payload: RoomUnsubscribePayload) => void;
  "peer.signal": (payload: z.infer<typeof peerSignalMessageSchema>) => void;
  "room.chat": (payload: RoomChatInputPayload) => void;
  "diagnostics.report": (payload: DiagnosticsReportPayload) => void;
};
