import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import {
  createApiErrorResponse,
  errorCodes,
  type ApiErrorResponse,
  type ErrorCode
} from "@music-room/shared";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== "http") {
      throw exception;
    }

    const context = host.switchToHttp();
    const response = context.getResponse();
    const { status, body } = toHttpApiError(exception);

    response.status(status).json(body);
  }
}

export function toHttpApiError(exception: unknown): {
  status: number;
  body: ApiErrorResponse;
} {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const message = getExceptionMessage(response, exception.message);
    const code = getApiErrorCode(response) ?? mapErrorCode(message, status);
    const details = typeof response === "object" && response !== null && "details" in response
      ? (response as { details?: unknown }).details
      : undefined;

    return {
      status,
      body: createApiErrorResponse(code, message, details)
    };
  }

  const message = exception instanceof Error ? exception.message : "Internal server error.";
  const code = mapErrorCode(message, HttpStatus.INTERNAL_SERVER_ERROR);
  return {
    status: mapErrorStatus(code),
    body: createApiErrorResponse(code, message)
  };
}

export function mapErrorCode(message: string, status?: number): ErrorCode {
  if (message.includes("NetEase integration is disabled")) {
    return errorCodes.neteaseDisabled;
  }
  if (message.includes("NetEase account is required")) {
    return errorCodes.neteaseAccountRequired;
  }
  if (message.includes("NetEase account") && message.includes("bound again")) {
    return errorCodes.neteaseAuthExpired;
  }
  if (message.includes("NetEase audio") && message.includes("too large")) {
    return errorCodes.neteaseImportTooLarge;
  }
  if (message.includes("unsupported audio")) {
    return errorCodes.neteaseAudioUnsupported;
  }
  if (message.includes("NetEase")) {
    return errorCodes.neteaseUnavailable;
  }

  if (message.includes("Realtime sync unavailable") || message.includes("Redis unavailable")) {
    return errorCodes.realtimeUnavailable;
  }

  if (
    message.includes("Playback state version conflict") ||
    message.includes("Room state revision conflict")
  ) {
    return errorCodes.playbackVersionConflict;
  }

  if (
    message.includes("Track owner is not online") ||
    message.includes("All track uploaders must be online")
  ) {
    return errorCodes.trackOwnerOffline;
  }

  if (
    message.includes("Room not found") ||
    message.includes("room.snapshot.missing") ||
    message.includes("Track not found") ||
    message.includes("Queue item not found") ||
    message.includes("Playlist not found")
  ) {
    return errorCodes.roomNotFound;
  }

  if (
    message.includes("Only room members can perform this action") ||
    message.includes("Only the host") ||
    message.includes("Only the original uploader") ||
    message.includes("Only the playlist owner")
  ) {
    return errorCodes.unauthorizedRoomAction;
  }

  if (message.includes("rate limit") || status === HttpStatus.TOO_MANY_REQUESTS) {
    return errorCodes.rateLimited;
  }

  if (
    message.includes("Unauthorized") ||
    message.includes("Invalid session token") ||
    message.includes("Invalid username or password")
  ) {
    return errorCodes.unauthorized;
  }

  if (
    status === HttpStatus.BAD_REQUEST ||
    message.includes("Username already exists") ||
    message.includes("Queue reorder payload does not match") ||
    message.includes("No tracks from this playlist are available")
  ) {
    return errorCodes.validationFailed;
  }

  if (status === HttpStatus.NOT_FOUND) {
    return errorCodes.roomNotFound;
  }

  if (status === HttpStatus.UNAUTHORIZED) {
    return errorCodes.unauthorized;
  }

  if (status === HttpStatus.FORBIDDEN) {
    return errorCodes.unauthorizedRoomAction;
  }

  if (status === HttpStatus.SERVICE_UNAVAILABLE) {
    return errorCodes.realtimeUnavailable;
  }

  return errorCodes.internal;
}

export function mapErrorStatus(code: ErrorCode): number {
  switch (code) {
    case errorCodes.validationFailed:
      return HttpStatus.BAD_REQUEST;
    case errorCodes.unauthorized:
      return HttpStatus.UNAUTHORIZED;
    case errorCodes.rateLimited:
      return HttpStatus.TOO_MANY_REQUESTS;
    case errorCodes.roomNotFound:
      return HttpStatus.NOT_FOUND;
    case errorCodes.playbackVersionConflict:
    case errorCodes.trackOwnerOffline:
      return HttpStatus.CONFLICT;
    case errorCodes.unauthorizedRoomAction:
      return HttpStatus.FORBIDDEN;
    case errorCodes.realtimeUnavailable:
      return HttpStatus.SERVICE_UNAVAILABLE;
    case errorCodes.neteaseUnavailable:
      return HttpStatus.BAD_GATEWAY;
    case errorCodes.neteaseDisabled:
      return HttpStatus.SERVICE_UNAVAILABLE;
    case errorCodes.neteaseAccountRequired:
    case errorCodes.neteaseAuthExpired:
    case errorCodes.neteaseQrExpired:
      return HttpStatus.CONFLICT;
    case errorCodes.neteaseTrackNotFound:
      return HttpStatus.NOT_FOUND;
    case errorCodes.neteaseAudioUnsupported:
      return HttpStatus.UNSUPPORTED_MEDIA_TYPE;
    case errorCodes.neteaseImportTooLarge:
      return HttpStatus.PAYLOAD_TOO_LARGE;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

function getApiErrorCode(response: string | object): ErrorCode | null {
  if (typeof response !== "object" || response === null || !("code" in response)) {
    return null;
  }

  const code = (response as { code?: unknown }).code;
  return typeof code === "string" && Object.values(errorCodes).includes(code as ErrorCode)
    ? (code as ErrorCode)
    : null;
}

function getExceptionMessage(response: string | object, fallback: string) {
  if (typeof response === "string") {
    return response;
  }

  if (response && typeof response === "object" && "message" in response) {
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return message.join(", ");
    }
    if (typeof message === "string") {
      return message;
    }
  }

  return fallback || "Internal server error.";
}
