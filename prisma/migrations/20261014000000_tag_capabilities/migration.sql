-- Tag kind (QR | NFC | URL) becomes two independent capabilities.
ALTER TABLE "Tag" ADD COLUMN "qr" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "nfc" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Tag" SET "qr" = ("kind" = 'QR'), "nfc" = ("kind" = 'NFC');

ALTER TABLE "Tag" DROP COLUMN "kind";

DROP TYPE "TagKind";
