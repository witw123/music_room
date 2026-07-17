import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoomCoreModule } from "../room/room-core.module";
import { PlaylistModule } from "../playlist/playlist.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Module({ imports: [AuthModule, RoomCoreModule, PlaylistModule], controllers: [AdminController], providers: [AdminService, AdminGuard] })
export class AdminModule {}
