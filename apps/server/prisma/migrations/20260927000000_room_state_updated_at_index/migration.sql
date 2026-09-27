-- 房间目录按 updatedAt 倒序与 freshness 探针都按该列过滤/排序,补齐索引。
CREATE INDEX "RoomState_updatedAt_idx" ON "RoomState"("updatedAt");
