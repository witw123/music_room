import { RoomPresenceOrchestratorService } from "./room-presence-orchestrator.service";

function createService(redis: Record<string, unknown>) {
  return new RoomPresenceOrchestratorService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    redis as never
  );
}

describe("RoomPresenceOrchestratorService", () => {
  it("serializes a presence operation through the distributed room lock", async () => {
    const acquireLock = jest.fn().mockResolvedValue("lock-token");
    const releaseLock = jest.fn().mockResolvedValue(true);
    const operation = jest.fn().mockResolvedValue("done");
    const service = createService({
      acquireLock,
      releaseLock,
      isAvailable: () => true
    });

    await expect(service.enqueuePresenceUpdate("room-1", "member-1", operation)).resolves.toBe("done");

    expect(acquireLock).toHaveBeenCalledWith("music-room:lock:room:room-1", 30_000);
    expect(releaseLock).toHaveBeenCalledWith("music-room:lock:room:room-1", "lock-token");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries revision conflicts without repeating a successful mutation", async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error("Room state revision conflict."))
      .mockResolvedValueOnce("done");
    const service = createService({ isAvailable: () => false });

    await expect(service.enqueuePresenceUpdate("room-1", "member-1", operation)).resolves.toBe("done");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not turn a lock-release failure into a failed presence mutation", async () => {
    const releaseLock = jest.fn().mockRejectedValue(new Error("redis release failed"));
    const service = createService({
      acquireLock: jest.fn().mockResolvedValue("lock-token"),
      releaseLock,
      isAvailable: () => true
    });

    await expect(
      service.enqueuePresenceUpdate("room-1", "member-1", async () => "done")
    ).resolves.toBe("done");
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
