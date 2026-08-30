import { Module } from "@nestjs/common";
import { SecurityModule } from "../../common/security/security.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TurnstileService } from "./turnstile.service";

@Module({
  imports: [SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, TurnstileService],
  exports: [AuthService, TurnstileService]
})
export class AuthModule {}
