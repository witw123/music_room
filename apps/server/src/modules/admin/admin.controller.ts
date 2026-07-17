import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AdminGuard } from "./admin.guard";
import { AdminService, adminCsrfCookie, adminSessionCookie } from "./admin.service";

@Controller("v1/admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post("auth/login")
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    const result = await this.admin.login(body, request);
    const secure = process.env.NODE_ENV === "production";
    response.cookie(adminSessionCookie, result.sessionToken, { httpOnly: true, sameSite: "strict", secure, maxAge: 8 * 60 * 60 * 1000, path: "/" });
    response.cookie(adminCsrfCookie, result.csrfToken, { httpOnly: false, sameSite: "strict", secure, maxAge: 8 * 60 * 60 * 1000, path: "/" });
    return { ...result.principal, csrfToken: result.csrfToken };
  }

  @UseGuards(AdminGuard)
  @Post("auth/logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    await this.admin.logout(request); response.clearCookie(adminSessionCookie, { path: "/" }); response.clearCookie(adminCsrfCookie, { path: "/" }); return { ok: true };
  }

  @UseGuards(AdminGuard)
  @Get("session")
  session(@Req() request: Request & { admin?: any }) { const admin = request.admin; return { userId: admin.userId, username: admin.username, nickname: admin.nickname, role: admin.role, expiresAt: admin.expiresAt.toISOString(), csrfToken: admin.csrfToken }; }

  @UseGuards(AdminGuard)
  @Get("overview") overview() { return this.admin.overview(); }
  @UseGuards(AdminGuard)
  @Get("rooms") rooms(@Query() query: { q?: string; limit?: string }) { return this.admin.listRooms({ q: query.q, limit: Number(query.limit) || 50 }); }
  @UseGuards(AdminGuard)
  @Get("rooms/:roomId") room(@Param("roomId") roomId: string) { return this.admin.roomDetail(roomId); }
  @UseGuards(AdminGuard)
  @Post("rooms/:roomId/terminate") terminate(@Param("roomId") roomId: string, @Body() body: { reason: string; expectedJoinCode: string }, @Req() request: Request & { admin?: any }) { return this.admin.terminateRoom(request.admin, roomId, body, request); }
  @UseGuards(AdminGuard)
  @Get("users") users(@Query() query: { q?: string; limit?: string }) { return this.admin.listUsers({ q: query.q, limit: Number(query.limit) || 50 }); }
  @UseGuards(AdminGuard)
  @Get("users/:userId") user(@Param("userId") userId: string) { return this.admin.userDetail(userId); }
  @UseGuards(AdminGuard)
  @Patch("users/:userId/status") status(@Param("userId") userId: string, @Body() body: unknown, @Req() request: Request & { admin?: any }) { return this.admin.setUserStatus(request.admin, userId, body, request); }
  @UseGuards(AdminGuard)
  @Post("users/:userId/sessions/revoke") revoke(@Param("userId") userId: string, @Body() body: { reason: string }, @Req() request: Request & { admin?: any }) { return this.admin.revokeUserSessions(request.admin, userId, body.reason, request); }
  @UseGuards(AdminGuard)
  @Get("incidents") incidents(@Query("limit") limit?: string) { return this.admin.listIncidents(Number(limit) || 50); }
  @UseGuards(AdminGuard)
  @Get("audit-logs") audit(@Query("limit") limit?: string) { return this.admin.listAudit(Number(limit) || 50); }
  @UseGuards(AdminGuard)
  @Get("system") system() { return this.admin.overview(); }
}
