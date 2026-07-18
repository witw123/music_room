DROP INDEX IF EXISTS "UserSession_token_key";

ALTER TABLE "UserSession" RENAME COLUMN "token" TO "tokenHash";

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
