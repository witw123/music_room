import { HttpException } from "@nestjs/common";
import { MetricsService } from "../../common/metrics/metrics.service";
import { PlaybackController } from "./playback.controller";

describe("PlaybackController", () => {
  function createAuthServiceMock() {
    return {
      getAuthSessionByTokenOrThrow: jest.fn().mockResolvedValue({
        id: "guest_host",
        userId: "guest_host",
        username: "host",
        nickname: "Host",
        token: "token",
        createdAt: new Date().toISOString()
      })
    };
  }

  it("maps playback version conflicts to http 409", async () => {
    const roomService = {
      isRealtimeAvailable: jest.fn().mockReturnValue(true),
      updatePlayback: jest.fn().mockRejectedValue(new Error("Playback state version conflict."))
    };
    const roomRealtimePublisher = {
      emitPlaybackPatch: jest.fn()
    };
    const controller = new PlaybackController(
      roomService as never,
      roomRealtimePublisher as never,
      createAuthServiceMock() as never,
      new MetricsService()
    );

    try {
      await controller.updatePlayback("room_1", "token", {
        action: "play",
        expectedVersion: 2
      });
      throw new Error("Expected updatePlayback to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).message).toBe("Playback state version conflict.");
      expect((error as HttpException).getResponse()).toEqual({
        code: "PLAYBACK_VERSION_CONFLICT",
        message: "Playback state version conflict."
      });
    }
  });

  it("maps room persistence CAS conflicts to the playback conflict response", async () => {
    const roomService = {
      isRealtimeAvailable: jest.fn().mockReturnValue(true),
      updatePlayback: jest.fn().mockRejectedValue(new Error("Room state revision conflict."))
    };
    const controller = new PlaybackController(
      roomService as never,
      { emitPlaybackPatch: jest.fn() } as never,
      createAuthServiceMock() as never,
      new MetricsService()
    );

    await expect(
      controller.updatePlayback("room_1", "token", {
        action: "pause",
        positionMs: 1_000,
        expectedVersion: 2
      })
    ).rejects.toMatchObject({
      response: {
        code: "PLAYBACK_VERSION_CONFLICT",
        message: "Playback state version conflict."
      },
      status: 409
    });
  });


  it("maps host-only playback control failures to http 403", async () => {
    const roomService = {
      isRealtimeAvailable: jest.fn().mockReturnValue(true),
      updatePlayback: jest.fn().mockRejectedValue(new Error("Only the room host can control playback."))
    };
    const controller = new PlaybackController(
      roomService as never,
      { emitPlaybackPatch: jest.fn() } as never,
      createAuthServiceMock() as never,
      new MetricsService()
    );

    await expect(
      controller.updatePlayback("room_1", "token", {
        action: "play",
        expectedVersion: 1
      })
    ).rejects.toMatchObject({
      response: {
        code: "UNAUTHORIZED_ROOM_ACTION",
        message: "Only the room host can control playback."
      },
      status: 403
    });
  });

  it("rejects invalid playback payloads before calling the service", async () => {
    const roomService = {
      isRealtimeAvailable: jest.fn().mockReturnValue(true),
      updatePlayback: jest.fn()
    };
    const controller = new PlaybackController(
      roomService as never,
      { emitPlaybackPatch: jest.fn() } as never,
      createAuthServiceMock() as never,
      new MetricsService()
    );

    await expect(
      controller.updatePlayback("room_1", "token", {
        action: "seek",
        positionMs: -1,
        expectedVersion: 1
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "VALIDATION_FAILED"
      })
    });
    expect(roomService.updatePlayback).not.toHaveBeenCalled();
  });
});
