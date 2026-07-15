CREATE TABLE "NeteaseAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "neteaseUserId" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "encryptedCookie" TEXT NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeteaseAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NeteaseAccount_userId_key" ON "NeteaseAccount"("userId");

ALTER TABLE "NeteaseAccount" ADD CONSTRAINT "NeteaseAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
