import { WsException } from "@nestjs/websockets";
import { createApiErrorResponse, type ErrorCode } from "@music-room/shared";
import { mapErrorCode } from "./api-exception.filter";

export function createWsApiException(message: string, code?: ErrorCode, details?: unknown) {
  return new WsException(createApiErrorResponse(code ?? mapErrorCode(message), message, details));
}

