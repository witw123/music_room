import { HttpStatus } from "@nestjs/common";
import { errorCodes } from "@music-room/shared";
import { toHttpApiError } from "./api-exception.filter";

describe("toHttpApiError", () => {
  it("maps plain business errors to their HTTP status instead of 500", () => {
    expect(toHttpApiError(new Error("Only room members can perform this action."))).toEqual({
      status: HttpStatus.FORBIDDEN,
      body: {
        code: errorCodes.unauthorizedRoomAction,
        message: "Only room members can perform this action."
      }
    });

    expect(toHttpApiError(new Error("Playback state version conflict."))).toEqual({
      status: HttpStatus.CONFLICT,
      body: {
        code: errorCodes.playbackVersionConflict,
        message: "Playback state version conflict."
      }
    });

    expect(toHttpApiError(new Error("Realtime sync unavailable."))).toEqual({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: {
        code: errorCodes.realtimeUnavailable,
        message: "Realtime sync unavailable."
      }
    });
  });

  it("maps missing room resources and offline owners to API statuses", () => {
    expect(toHttpApiError(new Error("Track not found in room: track_1"))).toEqual({
      status: HttpStatus.NOT_FOUND,
      body: {
        code: errorCodes.roomNotFound,
        message: "Track not found in room: track_1"
      }
    });

    expect(
      toHttpApiError(
        new Error("Track owner is not online, so this song cannot be played right now.")
      )
    ).toEqual({
      status: HttpStatus.CONFLICT,
      body: {
        code: errorCodes.trackOwnerOffline,
        message: "Track owner is not online, so this song cannot be played right now."
      }
    });
  });
});
