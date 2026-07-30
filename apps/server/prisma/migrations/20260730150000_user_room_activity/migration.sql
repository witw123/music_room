CREATE TABLE "UserRoomActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "totalDurationMs" BIGINT NOT NULL DEFAULT 0,
    "activeStartedAt" TIMESTAMP(3),
    "lastPresenceAt" TIMESTAMP(3),
    "lastJoinedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRoomActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRoomActivity_userId_roomId_key"
    ON "UserRoomActivity"("userId", "roomId");

CREATE INDEX "UserRoomActivity_userId_lastJoinedAt_idx"
    ON "UserRoomActivity"("userId", "lastJoinedAt");

ALTER TABLE "UserRoomActivity"
    ADD CONSTRAINT "UserRoomActivity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
