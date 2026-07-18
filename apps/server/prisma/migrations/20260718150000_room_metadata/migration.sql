ALTER TABLE "RoomState" ADD COLUMN "name" TEXT NOT NULL DEFAULT '未命名房间';
ALTER TABLE "RoomState" ADD COLUMN "description" TEXT;
ALTER TABLE "RoomState" ADD COLUMN "passwordHash" TEXT;
