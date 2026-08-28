-- Attribute a purchase to the vendor that supplied it.
-- Nullable: existing movements predate the field and cannot be attributed.
ALTER TABLE "stock_movements" ADD COLUMN "vendorId" TEXT;

CREATE INDEX "stock_movements_vendorId_createdAt_idx" ON "stock_movements"("vendorId", "createdAt");

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
