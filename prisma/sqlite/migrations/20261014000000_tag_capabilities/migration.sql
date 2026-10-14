-- Tag kind (QR | NFC | URL) becomes two independent capabilities.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "choreId" TEXT NOT NULL,
    "qr" BOOLEAN NOT NULL DEFAULT true,
    "nfc" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "Tag_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Tag_choreId_fkey" FOREIGN KEY ("choreId") REFERENCES "Chore" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Tag" ("id", "token", "groupId", "choreId", "qr", "nfc", "label", "createdAt", "lastUsedAt", "revokedAt")
SELECT "id", "token", "groupId", "choreId", "kind" = 'QR', "kind" = 'NFC', "label", "createdAt", "lastUsedAt", "revokedAt" FROM "Tag";
DROP TABLE "Tag";
ALTER TABLE "new_Tag" RENAME TO "Tag";
CREATE UNIQUE INDEX "Tag_token_key" ON "Tag"("token");
CREATE INDEX "Tag_groupId_idx" ON "Tag"("groupId");
CREATE INDEX "Tag_choreId_idx" ON "Tag"("choreId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
