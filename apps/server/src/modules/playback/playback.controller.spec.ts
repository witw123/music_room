import { HttpException } from "@nestjs/common";
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
    const signalingGateway = {
      emitPlaybackPatch: jest.fn()
    };
    const controller = new PlaybackController(
      roomService as never,
      signalingGateway as never,
      createAuthServiceMock() as never
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
    }
  });
});
