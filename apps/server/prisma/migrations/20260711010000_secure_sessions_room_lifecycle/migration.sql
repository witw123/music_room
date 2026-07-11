-- This release intentionally invalidates all legacy bearer-token sessions.
DELETE FROM "UserSession";
DELETE FROM "Playlist" p WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = p."ownerId");

ALTER TABLE "UserSession" DROP COLUMN "token";
ALTER TABLE "UserSession" ADD COLUMN "tokenHash" TEXT NOT NULL;

ALTER TABLE "RoomState"
  ADD COLUMN "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "RoomState" SET "lastActiveAt" = "updatedAt";

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
CREATE INDEX "Playlist_roomId_idx" ON "Playlist"("roomId");

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Playlist"
  ADD CONSTRAINT "Playlist_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
