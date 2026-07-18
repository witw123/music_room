CREATE TABLE "QqMusicAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qqMusicUserId" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "encryptedCookie" TEXT NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqMusicAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QqMusicAccount_userId_key" ON "QqMusicAccount"("userId");
ALTER TABLE "QqMusicAccount" ADD CONSTRAINT "QqMusicAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
