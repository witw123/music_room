import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FavoriteTracksController, FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";

@Module({
  imports: [AuthModule],
  controllers: [FavoritesController, FavoriteTracksController],
  providers: [FavoritesService]
})
export class FavoritesModule {}
