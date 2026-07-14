import { z } from "zod";
import { sha256HexSchema } from "../assets/models";

export const p2pProtocolVersion = 4 as const;
export const segmentedOpusCapability = "webrtc-opus-v1" as const;

export const assetUnitRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative()
}).refine((range) => range.end >= range.start, "Range end must not precede start.");

export const assetAvailabilityAnnouncementSchema = z.object({
  protocolVersion: z.literal(p2pProtocolVersion),
  roomId: z.string().min(1),
  assetId: sha256HexSchema,
  assetKind: z.literal("original"),
  ownerPeerId: z.string().min(1),
  nickname: z.string().min(1),
  totalUnits: z.number().int().positive(),
  availableRanges: z.array(assetUnitRangeSchema),
  complete: z.boolean(),
  source: z.enum(["live_upload", "local_cache"]),
  announcedAt: z.string().datetime()
}).strict().superRefine((announcement, context) => {
  for (const range of announcement.availableRanges) {
    if (range.end >= announcement.totalUnits) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["availableRanges"],
        message: "Availability range exceeds the asset unit count."
      });
      break;
    }
  }
  if (announcement.complete) {
    const coversAll =
      announcement.availableRanges.length === 1 &&
      announcement.availableRanges[0]?.start === 0 &&
      announcement.availableRanges[0]?.end === announcement.totalUnits - 1;
    if (!coversAll) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["complete"],
        message: "Complete assets must announce one full availability range."
      });
    }
  }
});

export const assetStreamMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("asset-stream-open"),
    protocolVersion: z.literal(p2pProtocolVersion),
    streamId: z.string().min(1),
    assetId: sha256HexSchema,
    assetKind: z.literal("original"),
    generation: z.number().int().nonnegative(),
    priority: z.enum(["critical", "playback-fill", "bulk"]),
    ranges: z.array(assetUnitRangeSchema).min(1),
    initialCreditBytes: z.number().int().min(256 * 1024).max(4 * 1024 * 1024)
  }),
  z.object({
    kind: z.literal("asset-stream-credit"),
    protocolVersion: z.literal(p2pProtocolVersion),
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    unitIndex: z.number().int().nonnegative(),
    creditBytes: z.number().int().positive()
  }),
  z.object({
    kind: z.literal("asset-stream-ack"),
    protocolVersion: z.literal(p2pProtocolVersion),
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    unitIndex: z.number().int().nonnegative(),
    storedBytes: z.number().int().positive()
  }),
  z.object({
    kind: z.literal("asset-stream-nack"),
    protocolVersion: z.literal(p2pProtocolVersion),
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    unitIndex: z.number().int().nonnegative(),
    reason: z.enum([
      "hash-mismatch",
      "proof-mismatch",
      "decode-failure",
      "storage-failure",
      "receiver-overloaded"
    ]),
    refundCreditBytes: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal("asset-stream-reset"),
    protocolVersion: z.literal(p2pProtocolVersion),
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    reason: z.enum(["peer-closed", "timeout", "superseded", "protocol-error"])
  })
]);

export const assetPeerSignalMessageSchema = z.object({
  protocolVersion: z.literal(p2pProtocolVersion),
  capability: z.literal(segmentedOpusCapability),
  roomId: z.string(),
  fromPeerId: z.string(),
  toPeerId: z.string(),
  channelKind: z.literal("data"),
  recoveryGeneration: z.number().int().nonnegative().optional(),
  type: z.enum(["offer", "answer", "candidate"]),
  payload: z.record(z.unknown())
}).strict().superRefine((message, context) => {
  const keys = Object.keys(message.payload);
  if (message.type === "offer" || message.type === "answer") {
    const allowed = new Set(["type", "sdp"]);
    if (
      keys.some((key) => !allowed.has(key)) ||
      message.payload.type !== message.type ||
      typeof message.payload.sdp !== "string" ||
      message.payload.sdp.length > 1024 * 1024
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "Invalid SDP signaling payload."
      });
    }
    return;
  }

  const allowed = new Set(["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"]);
  const candidate = message.payload.candidate;
  if (
    keys.some((key) => !allowed.has(key)) ||
    typeof candidate !== "string" ||
    candidate.length > 16 * 1024 ||
    (message.payload.sdpMid !== undefined && typeof message.payload.sdpMid !== "string") ||
    (message.payload.sdpMLineIndex !== undefined &&
      (!Number.isInteger(message.payload.sdpMLineIndex) ||
        (message.payload.sdpMLineIndex as number) < 0)) ||
    (message.payload.usernameFragment !== undefined &&
      typeof message.payload.usernameFragment !== "string")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload"],
      message: "Invalid ICE candidate signaling payload."
    });
  }
});

export type AssetUnitRange = z.infer<typeof assetUnitRangeSchema>;
export type AssetAvailabilityAnnouncement = z.infer<typeof assetAvailabilityAnnouncementSchema>;
export type AssetStreamMessage = z.infer<typeof assetStreamMessageSchema>;
export type AssetPeerSignalMessage = z.infer<typeof assetPeerSignalMessageSchema>;
