import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { adminLoginRequestSchema, adminReasonSchema, adminUserStatusSchema } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { RoomService } from "../room/room.service";
import { PlaylistService } from "../playlist/playlist.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";

export const adminSessionCookie = "music_room_admin_session";
export const adminCsrfCookie = "music_room_admin_csrf";
const adminAbsoluteTtlMs = 8 * 60 * 60 * 1000;
const adminIdleTtlMs = 30 * 60 * 1000;

type AdminPrincipal = { userId: string; username: string; nickname: string; role: "ADMIN"; csrfToken: string; expiresAt: Date };

@Injectable()
export class AdminService implements OnModuleInit, OnModuleDestroy {
  private heartbeatTimer?: NodeJS.Timeout;
  private tombstoneTimer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly roomService: RoomService,
    private readonly playlistService: PlaylistService,
    private readonly roomPublisher: RoomRealtimePublisher
  ) {}

  onModuleInit() {
    this.heartbeatTimer = setInterval(() => { void this.writeInstanceHeartbeat(); }, 10_000);
    this.tombstoneTimer = setInterval(() => { void this.retryPendingTombstones(); }, 10_000);
    void this.writeInstanceHeartbeat();
  }

  onModuleDestroy() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); if (this.tombstoneTimer) clearInterval(this.tombstoneTimer); }

  private async writeInstanceHeartbeat() {
    if (!this.redis.isAvailable()) return;
    const instanceId = process.env.INSTANCE_ID?.trim() || process.env.HOSTNAME || `instance-${process.pid}`;
    await this.redis.setJson(`music-room:admin:instance:${instanceId}`, { instanceId, version: process.env.RELEASE_TAG || "dev", startedAt: process.uptime() }, 30).catch(() => undefined);
    await this.redis.addSortedSetScore("music-room:admin:instances", Date.now(), instanceId).catch(() => undefined);
  }

  private async retryPendingTombstones() {
    if (!(await this.prisma.ensureAvailable())) return;
    const pending = await this.prisma.roomTombstone.findMany({ where: { status: "PENDING", expiresAt: { gt: new Date() } }, take: 20 });
    for (const tombstone of pending) {
      try {
        await this.roomService.deleteRoomByAdmin(tombstone.roomId);
        await this.playlistService.deletePlaylistsForRoom(tombstone.roomId);
        this.roomPublisher.emitRoomDeleted(tombstone.roomId, Array.isArray(tombstone.trackIds) ? tombstone.trackIds.filter((id): id is string => typeof id === "string") : []);
        this.roomPublisher.emitRoomMissing(tombstone.roomId);
        await this.prisma.roomTombstone.update({ where: { roomId: tombstone.roomId }, data: { status: "SUCCEEDED" } });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Room not found")) {
          await this.prisma.roomTombstone.update({ where: { roomId: tombstone.roomId }, data: { status: "SUCCEEDED" } }).catch(() => undefined);
        }
      }
    }
  }

  async login(input: unknown, request: Request) {
    const payload = adminLoginRequestSchema.parse(input);
    if (process.env.NODE_ENV === "production" && !process.env.AUDIT_HASH_SECRET?.trim()) {
      throw new UnauthorizedException("管理员审计密钥未配置。");
    }
    await this.assertLoginAllowed(payload.username, request);
    let user: Awaited<ReturnType<AuthService["authenticateCredentials"]>>;
    try {
      user = await this.auth.authenticateCredentials(payload);
    } catch {
      throw new UnauthorizedException("用户名或密码错误。");
    }
    if (user.role !== "ADMIN" || user.status !== "ACTIVE") {
      throw new UnauthorizedException("管理员账号不可用。");
    }
    if (!(await this.prisma.ensureAvailable())) throw new UnauthorizedException("数据库暂不可用。");
    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + adminAbsoluteTtlMs);
    await this.prisma.adminSession.create({ data: { id: `admin_session_${randomUUID()}`, userId: user.id, tokenHash: hashToken(sessionToken), csrfHash: hashToken(csrfToken), createdAt: now, lastActiveAt: now, expiresAt } });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    await this.writeAudit(user.id, "admin.login", "user", user.id, null, "SUCCEEDED", request);
    return { sessionToken, csrfToken, principal: { userId: user.id, username: user.username, nickname: user.nickname, role: "ADMIN" as const, expiresAt: expiresAt.toISOString() } };
  }

  private async assertLoginAllowed(username: string, request: Request) {
    if (!this.redis.isAvailable()) {
      if (process.env.NODE_ENV === "production") throw new UnauthorizedException("登录限流依赖暂不可用。");
      return;
    }
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const normalized = username.trim().toLowerCase();
    const windowMs = 15 * 60 * 1000;
    const [ipCount, userCount] = await Promise.all([
      this.redis.incrementWithTtlMs(`music-room:admin:login:ip:${createHash("sha256").update(ip).digest("hex")}`, windowMs),
      this.redis.incrementWithTtlMs(`music-room:admin:login:user:${createHash("sha256").update(normalized).digest("hex")}`, windowMs)
    ]);
    if (ipCount > 5 || userCount > 5) throw new HttpException("登录尝试过于频繁，请稍后再试。", HttpStatus.TOO_MANY_REQUESTS);
  }

  async validateRequest(request: Request): Promise<AdminPrincipal> {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[adminSessionCookie];
    if (!token || !(await this.prisma.ensureAvailable())) throw new UnauthorizedException("需要管理员登录。");
    const row = await this.prisma.adminSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    const now = Date.now();
    if (!row || row.revokedAt || row.expiresAt.getTime() <= now || row.lastActiveAt.getTime() + adminIdleTtlMs <= now || row.user.role !== "ADMIN" || row.user.status !== "ACTIVE") throw new UnauthorizedException("管理员会话已失效。");
    if (request.method !== "GET") {
      const csrfHeader = request.headers["x-admin-csrf"];
      const csrfCookie = cookies[adminCsrfCookie];
      if (!csrfHeader || !csrfCookie || !safeEqual(hashToken(String(csrfHeader)), row.csrfHash) || !safeEqual(hashToken(csrfCookie), row.csrfHash)) throw new UnauthorizedException("CSRF 校验失败。");
      const origin = request.headers.origin;
      const allowedOrigins = (process.env.CORS_ORIGINS ?? `${request.protocol}://${request.get("host")}`).split(",").map((value) => value.trim()).filter(Boolean);
      if (!origin || !allowedOrigins.includes(origin)) throw new UnauthorizedException("Origin 校验失败。");
    }
    if (now - row.lastActiveAt.getTime() > 5 * 60 * 1000) void this.prisma.adminSession.update({ where: { id: row.id }, data: { lastActiveAt: new Date() } });
    return { userId: row.user.id, username: row.user.username, nickname: row.user.nickname, role: "ADMIN", csrfToken: cookies[adminCsrfCookie] ?? "", expiresAt: row.expiresAt };
  }

  async logout(request: Request) {
    if (!(await this.prisma.ensureAvailable())) return { ok: true };
    const token = parseCookies(request.headers.cookie)[adminSessionCookie];
    if (token) await this.prisma.adminSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async overview() {
    const now = new Date();
    const [users, rooms, incidents] = await Promise.all([this.prisma.user.findMany({ select: { status: true } }), this.prisma.roomState.findMany({ select: { members: true, playback: true } }), this.prisma.operationalIncident.count({ where: { status: "OPEN" } })]);
    const activeRooms = rooms.filter((room) => Array.isArray(room.members) && (room.members as unknown[]).some((member) => (member as { presenceState?: string }).presenceState === "online"));
    const playbackActive = rooms.filter((room) => (room.playback as { status?: string } | null)?.status === "playing").length;
    let instances = 1;
    if (this.redis.isAvailable()) {
      const stale = await this.redis.getSortedSetMembersByScore("music-room:admin:instances", "-inf", Date.now() - 30_000).catch(() => []);
      instances = Math.max(1, stale.length);
    }
    return { generatedAt: now.toISOString(), dependencies: { prisma: this.prisma.isAvailable() ? "up" : "down", redis: this.redis.isAvailable() ? "up" : "down", redisMode: this.redis.getMode() }, users: { total: users.length, online: 0, disabled: users.filter((user) => user.status === "DISABLED").length }, rooms: { total: rooms.length, active: activeRooms.length, healthy: 0, degraded: 0, critical: 0, unknown: rooms.length }, playback: { active: playbackActive, paused: Math.max(0, rooms.length - playbackActive) }, openIncidents: incidents, instances };
  }

  async listRooms(query: { q?: string; limit?: number }) {
    const rows = await this.prisma.roomState.findMany({ orderBy: { updatedAt: "desc" }, take: Math.min(query.limit ?? 50, 100) });
    const q = query.q?.trim().toLowerCase();
    const data = rows.filter((row) => !q || row.id.toLowerCase().includes(q) || row.joinCode.toLowerCase().includes(q)).map((row) => this.roomSummary(row));
    return { data, nextCursor: null, generatedAt: new Date().toISOString() };
  }

  async roomDetail(roomId: string) {
    const row = await this.prisma.roomState.findUnique({ where: { id: roomId } });
    if (!row) throw new NotFoundException("房间不存在。");
    return { ...this.roomSummary(row), playback: row.playback, queue: row.queue, tracks: row.tracks, members: row.members };
  }

  async listUsers(query: { q?: string; limit?: number }) {
    const rows = await this.prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(query.limit ?? 50, 100), include: { _count: { select: { userSessions: true } }, userSessions: { where: { expiresAt: { gt: new Date() } }, select: { id: true } } } });
    const q = query.q?.trim().toLowerCase();
    const data = rows.filter((row) => !q || row.username.includes(q) || row.nickname.toLowerCase().includes(q)).map((row) => ({ id: row.id, username: row.username, nickname: row.nickname, role: row.role, status: row.status, createdAt: row.createdAt.toISOString(), lastLoginAt: row.lastLoginAt?.toISOString() ?? null, activeSessionCount: row.userSessions.length, onlineRoomCount: 0 }));
    return { data, nextCursor: null, generatedAt: new Date().toISOString() };
  }

  async userDetail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, nickname: true, role: true, status: true, createdAt: true, lastLoginAt: true, disabledAt: true, disabledReason: true, userSessions: { where: { expiresAt: { gt: new Date() } }, select: { id: true, createdAt: true, expiresAt: true } } } });
    if (!user) throw new NotFoundException("用户不存在。");
    const audits = await this.prisma.adminAuditLog.findMany({ where: { targetType: "user", targetId: userId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, reason: true, result: true, createdAt: true } });
    return { ...user, createdAt: user.createdAt.toISOString(), lastLoginAt: user.lastLoginAt?.toISOString() ?? null, disabledAt: user.disabledAt?.toISOString() ?? null, sessions: user.userSessions.map((session) => ({ ...session, createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString() })), audits: audits.map((audit) => ({ ...audit, createdAt: audit.createdAt.toISOString() })) };
  }

  async setUserStatus(actor: AdminPrincipal, userId: string, statusInput: unknown, request: Request) {
    this.assertMutationsEnabled();
    const payload = adminUserStatusSchema.parse((statusInput as { status?: unknown }).status);
    if (userId === actor.userId) throw new ConflictException("不能修改当前管理员账号。");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role === "ADMIN") throw new NotFoundException("普通用户不存在。");
    const reason = adminReasonSchema.parse((statusInput as { reason?: unknown }).reason);
    const disabled = payload === "DISABLED";
    await this.prisma.$transaction(async (tx) => { await tx.user.update({ where: { id: userId }, data: { status: payload, disabledAt: disabled ? new Date() : null, disabledReason: disabled ? reason : null } }); if (disabled) await tx.userSession.deleteMany({ where: { userId } }); await tx.adminAuditLog.create({ data: { id: `audit_${randomUUID()}`, actorUserId: actor.userId, action: disabled ? "user.disable" : "user.enable", targetType: "user", targetId: userId, reason, result: "SUCCEEDED", userAgent: request.headers["user-agent"] ?? null } }); });
    await this.publishUserInvalidated(userId);
    return { ok: true, status: payload };
  }

  async revokeUserSessions(actor: AdminPrincipal, userId: string, reason: string, request: Request) {
    this.assertMutationsEnabled();
    if (userId === actor.userId) throw new ConflictException("不能撤销当前管理员会话。");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role === "ADMIN") throw new NotFoundException("普通用户不存在。");
    await this.prisma.userSession.deleteMany({ where: { userId } });
    await this.writeAudit(actor.userId, "user.sessions.revoke", "user", userId, adminReasonSchema.parse(reason), "SUCCEEDED", request);
    await this.publishUserInvalidated(userId);
    return { ok: true };
  }

  async terminateRoom(actor: AdminPrincipal, roomId: string, payload: { reason: string; expectedJoinCode: string }, request: Request) {
    this.assertMutationsEnabled();
    const reason = adminReasonSchema.parse(payload.reason);
    const room = await this.prisma.roomState.findUnique({ where: { id: roomId } });
    if (!room) return { ok: true, alreadyTerminated: true };
    if (room.joinCode !== payload.expectedJoinCode) throw new ConflictException("房间码已变化，请刷新后重试。");
    const tracks = Array.isArray(room.tracks) ? room.tracks.map((track) => (track as { id?: string }).id).filter((id): id is string => !!id) : [];
    await this.prisma.roomTombstone.upsert({ where: { roomId }, create: { id: `tombstone_${randomUUID()}`, roomId, trackIds: tracks, reason, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, update: { trackIds: tracks, reason, status: "PENDING" } });
    await this.roomService.deleteRoomByAdmin(roomId);
    await this.playlistService.deletePlaylistsForRoom(roomId);
    this.roomPublisher.emitRoomDeleted(roomId, tracks);
    this.roomPublisher.emitRoomMissing(roomId);
    await this.prisma.roomTombstone.update({ where: { roomId }, data: { status: "SUCCEEDED" } });
    await this.writeAudit(actor.userId, "room.terminate", "room", roomId, reason, "SUCCEEDED", request);
    return { ok: true, alreadyTerminated: false };
  }

  private assertMutationsEnabled() {
    if (process.env.ADMIN_MUTATIONS_ENABLED === "false") throw new ConflictException("管理动作当前已关闭。");
  }

  async listIncidents(limit = 50) { return { data: await this.prisma.operationalIncident.findMany({ orderBy: { lastSeenAt: "desc" }, take: Math.min(limit, 100) }), nextCursor: null, generatedAt: new Date().toISOString() }; }
  async listAudit(limit = 50) { return { data: await this.prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 100), select: { id: true, actorUserId: true, action: true, targetType: true, targetId: true, reason: true, result: true, createdAt: true } }), nextCursor: null, generatedAt: new Date().toISOString() }; }

  private roomSummary(row: { id: string; joinCode: string; visibility: string; hostId: string; members: unknown; playback: unknown; updatedAt: Date }) {
    const members = Array.isArray(row.members) ? row.members as Array<{ id?: string; nickname?: string; presenceState?: string }> : [];
    const playback = (row.playback ?? {}) as { status?: string; currentTrackId?: string };
    return { id: row.id, joinCode: row.joinCode, visibility: row.visibility, hostId: row.hostId, hostNickname: members.find((member) => member.id === row.hostId)?.nickname ?? null, memberCount: members.length, onlineMemberCount: members.filter((member) => member.presenceState === "online").length, playbackStatus: playback.status ?? "idle", currentTrackTitle: null, health: "unknown" as const, telemetryCoverage: { reported: 0, total: members.length }, updatedAt: row.updatedAt.toISOString() };
  }

  private async publishUserInvalidated(userId: string) {
    if (this.redis.isPubSubAvailable()) await this.redis.publish("music-room:auth:user-invalidated", { userId, at: new Date().toISOString() });
  }

  private async writeAudit(actorUserId: string, action: string, targetType: string, targetId: string | null, reason: string | null, result: string, request: Request) {
    if (!(await this.prisma.ensureAvailable())) return;
    const hashSecret = process.env.AUDIT_HASH_SECRET?.trim();
    if (!hashSecret && process.env.NODE_ENV === "production") {
      throw new Error("AUDIT_HASH_SECRET must be configured in production.");
    }
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    await this.prisma.adminAuditLog.create({ data: { id: `audit_${randomUUID()}`, actorUserId, action, targetType, targetId, reason, result, ipHash: createHmac("sha256", hashSecret || "development-audit-secret").update(ip).digest("hex"), userAgent: request.headers["user-agent"] ?? null } });
  }
}

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function parseCookies(raw?: string) { return Object.fromEntries((raw ?? "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, ...value]) => [key, value.join("=")])); }
