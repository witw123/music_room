CREATE TABLE "UserFavoriteAlbum" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAlbumId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "artworkUrl" TEXT,
    "description" TEXT,
    "releaseTime" TEXT,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFavoriteAlbum_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserFavoriteAlbum_userId_provider_providerAlbumId_key"
    ON "UserFavoriteAlbum"("userId", "provider", "providerAlbumId");

CREATE INDEX "UserFavoriteAlbum_userId_updatedAt_idx"
    ON "UserFavoriteAlbum"("userId", "updatedAt");

ALTER TABLE "UserFavoriteAlbum"
    ADD CONSTRAINT "UserFavoriteAlbum_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
