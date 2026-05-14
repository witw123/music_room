ALTER TABLE "RoomState"
  ADD COLUMN IF NOT EXISTS "roomRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "presenceRevision" INTEGER NOT NULL DEFAULT 0;

UPDATE "RoomState"
SET
  "roomRevision" = COALESCE(("playback"->>'roomRevision')::INTEGER, "roomRevision"),
  "presenceRevision" = COALESCE(("playback"->>'presenceRevision')::INTEGER, "presenceRevision")
WHERE "playback" ? 'roomRevision' OR "playback" ? 'presenceRevision';
