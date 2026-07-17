import { Injectable } from "@nestjs/common";

type CounterName =
  | "realtimeFailures"
  | "playbackConflicts"
  | "iceFailures"
  | "diagnosticsReports"
  | "diagnosticsRateLimited";

@Injectable()
export class MetricsService {
  private readonly socketRooms = new Map<string, string>();
  private readonly roomSockets = new Map<string, Set<string>>();
  private readonly counters: Record<CounterName, number> = {
    realtimeFailures: 0,
    playbackConflicts: 0,
    iceFailures: 0,
    diagnosticsReports: 0,
    diagnosticsRateLimited: 0
  };

  bindRealtimeSocket(socketId: string, roomId: string) {
    this.unbindRealtimeSocket(socketId);
    this.socketRooms.set(socketId, roomId);
    const sockets = this.roomSockets.get(roomId) ?? new Set<string>();
    sockets.add(socketId);
    this.roomSockets.set(roomId, sockets);
  }

  unbindRealtimeSocket(socketId: string) {
    const roomId = this.socketRooms.get(socketId);
    if (!roomId) {
      return;
    }

    this.socketRooms.delete(socketId);
    const sockets = this.roomSockets.get(roomId);
    sockets?.delete(socketId);
    if (sockets && sockets.size === 0) {
      this.roomSockets.delete(roomId);
    }
  }

  clearRoom(roomId: string) {
    const sockets = this.roomSockets.get(roomId);
    if (!sockets) {
      return;
    }

    for (const socketId of sockets) {
      this.socketRooms.delete(socketId);
    }
    this.roomSockets.delete(roomId);
  }

  incrementRealtimeFailure() {
    this.counters.realtimeFailures += 1;
  }

  incrementPlaybackConflict() {
    this.counters.playbackConflicts += 1;
  }

  incrementIceFailure() {
    this.counters.iceFailures += 1;
  }

  incrementDiagnosticsReport() { this.counters.diagnosticsReports += 1; }
  incrementDiagnosticsRateLimited() { this.counters.diagnosticsRateLimited += 1; }

  snapshot() {
    return {
      wsConnections: this.socketRooms.size,
      activeRooms: this.roomSockets.size,
      ...this.counters
    };
  }

  renderPrometheus(input: {
    prismaAvailable: boolean;
    redisAvailable: boolean;
  }) {
    const snapshot = this.snapshot();
    return [
      "# HELP music_room_ws_connections Active Socket.IO room-bound connections.",
      "# TYPE music_room_ws_connections gauge",
      `music_room_ws_connections ${snapshot.wsConnections}`,
      "# HELP music_room_active_rooms Rooms with at least one active realtime socket.",
      "# TYPE music_room_active_rooms gauge",
      `music_room_active_rooms ${snapshot.activeRooms}`,
      "# HELP music_room_realtime_failures_total Realtime operations rejected because Redis/realtime sync was unavailable.",
      "# TYPE music_room_realtime_failures_total counter",
      `music_room_realtime_failures_total ${snapshot.realtimeFailures}`,
      "# HELP music_room_playback_conflicts_total Playback control requests rejected due to version conflicts.",
      "# TYPE music_room_playback_conflicts_total counter",
      `music_room_playback_conflicts_total ${snapshot.playbackConflicts}`,
      "# HELP music_room_ice_failures_total ICE config requests that failed before returning usable ICE servers.",
      "# TYPE music_room_ice_failures_total counter",
      `music_room_ice_failures_total ${snapshot.iceFailures}`,
      "# HELP music_room_prisma_available Prisma database availability, 1 for up and 0 for down.",
      "# TYPE music_room_prisma_available gauge",
      `music_room_prisma_available ${input.prismaAvailable ? 1 : 0}`,
      "# HELP music_room_redis_available Redis availability, 1 for up and 0 for down.",
      "# TYPE music_room_redis_available gauge",
      `music_room_redis_available ${input.redisAvailable ? 1 : 0}`,
      "# HELP music_room_diagnostics_reports_total Accepted client diagnostics reports.",
      "# TYPE music_room_diagnostics_reports_total counter",
      `music_room_diagnostics_reports_total ${snapshot.diagnosticsReports}`,
      "# HELP music_room_diagnostics_rate_limited_total Client diagnostics reports rejected by rate limit.",
      "# TYPE music_room_diagnostics_rate_limited_total counter",
      `music_room_diagnostics_rate_limited_total ${snapshot.diagnosticsRateLimited}`,
      ""
    ].join("\n");
  }
}

