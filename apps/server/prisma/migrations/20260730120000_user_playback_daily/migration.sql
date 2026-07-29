CREATE TABLE "UserPlaybackDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTrackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "listenedMs" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPlaybackDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPlaybackDaily_userId_day_provider_providerTrackId_key"
    ON "UserPlaybackDaily"("userId", "day", "provider", "providerTrackId");

CREATE INDEX "UserPlaybackDaily_userId_day_idx"
    ON "UserPlaybackDaily"("userId", "day");

CREATE INDEX "UserPlaybackDaily_userId_lastPlayedAt_idx"
    ON "UserPlaybackDaily"("userId", "lastPlayedAt");

ALTER TABLE "UserPlaybackDaily"
    ADD CONSTRAINT "UserPlaybackDaily_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
