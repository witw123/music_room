import { z } from "zod";

export const errorCodes = {
  internal: "INTERNAL_ERROR",
  validationFailed: "VALIDATION_FAILED",
  unauthorized: "UNAUTHORIZED",
  rateLimited: "RATE_LIMITED",
  roomNotFound: "ROOM_NOT_FOUND",
  roomClosed: "ROOM_CLOSED",
  peerUnavailable: "PEER_UNAVAILABLE",
  chunkMissing: "CHUNK_MISSING",
  playbackOutOfSync: "PLAYBACK_OUT_OF_SYNC",
  realtimeUnavailable: "REALTIME_UNAVAILABLE",
  playbackVersionConflict: "PLAYBACK_VERSION_CONFLICT",
  trackOwnerOffline: "TRACK_OWNER_OFFLINE",
  unauthorizedRoomAction: "UNAUTHORIZED_ROOM_ACTION",
  neteaseDisabled: "NETEASE_DISABLED",
  neteaseAccountRequired: "NETEASE_ACCOUNT_REQUIRED",
  neteaseAuthExpired: "NETEASE_AUTH_EXPIRED",
  neteaseQrExpired: "NETEASE_QR_EXPIRED",
  neteaseTrackNotFound: "NETEASE_TRACK_NOT_FOUND",
  neteaseAudioUnsupported: "NETEASE_AUDIO_UNSUPPORTED",
  neteaseImportTooLarge: "NETEASE_IMPORT_TOO_LARGE",
  neteaseUnavailable: "NETEASE_UNAVAILABLE",
  metingDisabled: "METING_DISABLED",
  metingTrackNotFound: "METING_TRACK_NOT_FOUND",
  metingAudioUnsupported: "METING_AUDIO_UNSUPPORTED",
  metingImportTooLarge: "METING_IMPORT_TOO_LARGE",
  metingUnavailable: "METING_UNAVAILABLE"
} as const;

export const apiErrorResponseSchema = z.object({
  code: z.enum([
    errorCodes.internal,
    errorCodes.validationFailed,
    errorCodes.unauthorized,
    errorCodes.rateLimited,
    errorCodes.roomNotFound,
    errorCodes.roomClosed,
    errorCodes.peerUnavailable,
    errorCodes.chunkMissing,
    errorCodes.playbackOutOfSync,
    errorCodes.realtimeUnavailable,
    errorCodes.playbackVersionConflict,
    errorCodes.trackOwnerOffline,
    errorCodes.unauthorizedRoomAction,
    errorCodes.neteaseDisabled,
    errorCodes.neteaseAccountRequired,
    errorCodes.neteaseAuthExpired,
    errorCodes.neteaseQrExpired,
    errorCodes.neteaseTrackNotFound,
    errorCodes.neteaseAudioUnsupported,
    errorCodes.neteaseImportTooLarge,
    errorCodes.neteaseUnavailable,
    errorCodes.metingDisabled,
    errorCodes.metingTrackNotFound,
    errorCodes.metingAudioUnsupported,
    errorCodes.metingImportTooLarge,
    errorCodes.metingUnavailable
  ]),
  message: z.string(),
  details: z.unknown().optional()
});

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export function createApiErrorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown
): ApiErrorResponse {
  return details === undefined ? { code, message } : { code, message, details };
}
