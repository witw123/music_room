import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AdminService } from "./admin.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminService: AdminService) {}
  async canActivate(context: ExecutionContext) {
    if (process.env.ADMIN_PANEL_ENABLED === "false") return false;
    const request = context.switchToHttp().getRequest<Request & { admin?: unknown }>();
    request.res?.setHeader("Cache-Control", "no-store");
    request.admin = await this.adminService.validateRequest(request);
    return true;
  }
}
