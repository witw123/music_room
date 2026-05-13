import { BadRequestException } from "@nestjs/common";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";

type ParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        flatten: () => unknown;
      };
    };

type RequestSchema<T> = {
  safeParse: (payload: unknown) => ParseResult<T>;
};

export function parseRequestBody<T>(
  schema: RequestSchema<T>,
  payload: unknown
): T {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data;
  }

  throw new BadRequestException(
    createApiErrorResponse(
      errorCodes.validationFailed,
      "Invalid request payload.",
      result.error.flatten()
    )
  );
}
