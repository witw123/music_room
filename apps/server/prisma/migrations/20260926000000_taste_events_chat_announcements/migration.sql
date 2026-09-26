-- 用户画像(口味事件/实体/推荐排除)、 artist 收藏、房间聊天消息、系统公告。
-- 一次补齐 db push 期间累积的全部 schema 漂移,此后恢复 migrate deploy 工作流。

-- UserPlaybackDaily 已被 UserTasteEvent/Entity 取代。
DROP TABLE IF EXISTS "UserPlaybackDaily";

-- CreateTable
CREATE TABLE "RoomChatMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomChatMessage_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "SystemAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAnnouncement_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "UserFavoriteArtist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerArtistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artworkUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFavoriteArtist_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "UserRecommendationExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "label" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRecommendationExclusion_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "UserTasteEntity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityKind" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "provider" TEXT,
    "providerItemId" TEXT,
    "providerAlbumId" TEXT,
    "access" TEXT,
    "quality" TEXT,
    "title" TEXT,
    "artist" TEXT,
    "album" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "artworkUrl" TEXT,
    "positiveScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "negativeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interactionCount" INTEGER NOT NULL DEFAULT 0,
    "lastOccurredAt" TIMESTAMP(3),
    "lastRecommendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTasteEntity_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "UserTasteEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "surface" TEXT,
    "entityKind" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "provider" TEXT,
    "providerItemId" TEXT,
    "title" TEXT,
    "artist" TEXT,
    "album" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "listenedMs" BIGINT NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timezoneOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTasteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserFavoriteArtist_userId_updatedAt_idx" ON "UserFavoriteArtist"("userId", "updatedAt");
-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteArtist_userId_provider_providerArtistId_key" ON "UserFavoriteArtist"("userId", "provider", "providerArtistId");
-- CreateIndex
CREATE INDEX "UserTasteEvent_userId_occurredAt_idx" ON "UserTasteEvent"("userId", "occurredAt");
-- CreateIndex
CREATE UNIQUE INDEX "UserTasteEvent_userId_clientEventId_key" ON "UserTasteEvent"("userId", "clientEventId");
-- CreateIndex
CREATE INDEX "UserTasteEntity_userId_entityKind_lastOccurredAt_idx" ON "UserTasteEntity"("userId", "entityKind", "lastOccurredAt");
-- CreateIndex
CREATE UNIQUE INDEX "UserTasteEntity_userId_entityKind_entityKey_key" ON "UserTasteEntity"("userId", "entityKind", "entityKey");
-- CreateIndex
CREATE INDEX "UserRecommendationExclusion_userId_createdAt_idx" ON "UserRecommendationExclusion"("userId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "UserRecommendationExclusion_userId_targetKind_targetKey_key" ON "UserRecommendationExclusion"("userId", "targetKind", "targetKey");
-- CreateIndex
CREATE INDEX "RoomChatMessage_roomId_createdAt_id_idx" ON "RoomChatMessage"("roomId", "createdAt", "id");
-- CreateIndex
CREATE INDEX "SystemAnnouncement_isActive_createdAt_idx" ON "SystemAnnouncement"("isActive", "createdAt");

-- AddForeignKey
ALTER TABLE "UserFavoriteArtist" ADD CONSTRAINT "UserFavoriteArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "UserTasteEvent" ADD CONSTRAINT "UserTasteEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "UserTasteEntity" ADD CONSTRAINT "UserTasteEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "UserRecommendationExclusion" ADD CONSTRAINT "UserRecommendationExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
