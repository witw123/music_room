import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FavoriteArtistsController, FavoriteTracksController, FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";

@Module({
  imports: [AuthModule],
  controllers: [FavoritesController, FavoriteTracksController, FavoriteArtistsController],
  providers: [FavoritesService]
})
export class FavoritesModule {}
