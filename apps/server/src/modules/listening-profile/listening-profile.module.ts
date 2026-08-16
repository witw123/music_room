import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { ListeningProfileController } from "./listening-profile.controller";
import { ListeningProfileService } from "./listening-profile.service";

@Module({
  imports: [AuthModule, RecommendationsModule],
  controllers: [ListeningProfileController],
  providers: [ListeningProfileService]
})
export class ListeningProfileModule {}
