CREATE TABLE "RoomTrackDeletion" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "fileHash" TEXT,
    "originalAssetId" TEXT,
    "playbackAssetId" TEXT,
    "roomRevision" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomTrackDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomTrackDeletion_roomId_trackId_key" ON "RoomTrackDeletion"("roomId", "trackId");
CREATE INDEX "RoomTrackDeletion_roomId_roomRevision_idx" ON "RoomTrackDeletion"("roomId", "roomRevision");
CREATE INDEX "RoomTrackDeletion_expiresAt_idx" ON "RoomTrackDeletion"("expiresAt");
