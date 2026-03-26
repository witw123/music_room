export const errorCodes = {
  roomNotFound: "ROOM_NOT_FOUND",
  roomClosed: "ROOM_CLOSED",
  peerUnavailable: "PEER_UNAVAILABLE",
  chunkMissing: "CHUNK_MISSING",
  playbackOutOfSync: "PLAYBACK_OUT_OF_SYNC"
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];

