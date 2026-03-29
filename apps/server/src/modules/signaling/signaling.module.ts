import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SignalingGateway } from "./signaling.gateway";

@Module({
  imports: [AuthModule],
  providers: [SignalingGateway],
  exports: [SignalingGateway]
})
export class SignalingModule {}
