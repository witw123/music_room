import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  it("tracks active realtime sockets and rooms", () => {
    const metrics = new MetricsService();

    metrics.bindRealtimeSocket("socket_1", "room_1");
    metrics.bindRealtimeSocket("socket_2", "room_1");
    metrics.bindRealtimeSocket("socket_3", "room_2");

    expect(metrics.snapshot()).toMatchObject({
      wsConnections: 3,
      activeRooms: 2
    });

    metrics.unbindRealtimeSocket("socket_2");
    metrics.clearRoom("room_2");

    expect(metrics.snapshot()).toMatchObject({
      wsConnections: 1,
      activeRooms: 1
    });
  });

  it("renders prometheus counters and dependency gauges", () => {
    const metrics = new MetricsService();
    metrics.bindRealtimeSocket("socket_1", "room_1");
    metrics.incrementRealtimeFailure();
    metrics.incrementPlaybackConflict();
    metrics.incrementIceFailure();

    expect(
      metrics.renderPrometheus({
        prismaAvailable: true,
        redisAvailable: false
      })
    ).toContain("music_room_ws_connections 1");
    expect(
      metrics.renderPrometheus({
        prismaAvailable: true,
        redisAvailable: false
      })
    ).toContain("music_room_realtime_failures_total 1");
    expect(
      metrics.renderPrometheus({
        prismaAvailable: true,
        redisAvailable: false
      })
    ).toContain("music_room_redis_available 0");
  });
});

