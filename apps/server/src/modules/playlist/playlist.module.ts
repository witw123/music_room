import { Module } from "@nestjs/common";
import { PlaylistService } from "./playlist.service";

@Module({
  providers: [PlaylistService],
  exports: [PlaylistService]
})
export class PlaylistModule {}

