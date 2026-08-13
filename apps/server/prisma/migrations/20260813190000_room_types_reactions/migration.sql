ALTER TABLE "RoomState" ADD COLUMN "roomType" TEXT NOT NULL DEFAULT 'interactive';
ALTER TABLE "UserRoomActivity" ADD COLUMN "roomType" TEXT NOT NULL DEFAULT 'interactive';
CREATE TABLE "RoomReaction" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trackId" TEXT,
  "reactionType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomReaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RoomReaction_roomId_trackId_reactionType_createdAt_idx" ON "RoomReaction"("roomId", "trackId", "reactionType", "createdAt");
CREATE INDEX "RoomReaction_userId_createdAt_idx" ON "RoomReaction"("userId", "createdAt");
