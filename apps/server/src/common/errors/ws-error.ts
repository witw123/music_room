import { WsException } from "@nestjs/websockets";
import { createApiErrorResponse, type ErrorCode } from "@music-room/shared";
import { mapErrorCode } from "./api-exception.filter";

export function createWsApiException(message: string, code?: ErrorCode) {
  return new WsException(createApiErrorResponse(code ?? mapErrorCode(message), message));
}

