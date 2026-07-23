CREATE TABLE "UserFavoriteTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTrackId" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "quality" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "providerAlbumId" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "artworkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFavoriteTrack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserFavoriteTrack_userId_provider_providerTrackId_key"
    ON "UserFavoriteTrack"("userId", "provider", "providerTrackId");

CREATE INDEX "UserFavoriteTrack_userId_updatedAt_idx"
    ON "UserFavoriteTrack"("userId", "updatedAt");

ALTER TABLE "UserFavoriteTrack"
    ADD CONSTRAINT "UserFavoriteTrack_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
