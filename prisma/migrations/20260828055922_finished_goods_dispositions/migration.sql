-- Profit calculation: batch costing, selling price, customers and dispositions.

-- 1. A batch now carries what it actually cost.
--    Manufactured batches start provisional (material only) and are finalised
--    once the production run completes and labour can be apportioned.
ALTER TABLE "inventory_batches"
  ADD COLUMN "materialUnitCost" DECIMAL(12,4),
  ADD COLUMN "labourUnitCost"   DECIMAL(12,4),
  ADD COLUMN "unitCost"         DECIMAL(12,4),
  ADD COLUMN "costFinalizedAt"  TIMESTAMP(3);

CREATE INDEX "inventory_batches_sourceTaskId_idx" ON "inventory_batches"("sourceTaskId");

-- Backfill purchased batches from the movement that created them. Their cost
-- has always been recorded accurately; it simply lived only on the movement.
UPDATE "inventory_batches" b
SET "materialUnitCost" = m."unitCost",
    "unitCost"         = m."unitCost",
    "labourUnitCost"   = 0,
    "costFinalizedAt"  = b."createdAt"
FROM (
  SELECT DISTINCT ON ("batchId") "batchId", "unitCost"
  FROM "stock_movements"
  WHERE "type" = 'PURCHASE' AND "batchId" IS NOT NULL
  ORDER BY "batchId", "createdAt" ASC
) m
WHERE b."id" = m."batchId" AND b."sourceTaskId" IS NULL;

-- Manufactured batches are deliberately left NULL: their ASSEMBLY movement
-- recorded the product's LIST price as cost, which would overstate COGS.
-- `npm run backfill:batch-costs` recomputes them from their production runs.

-- 2. Default selling price for finished goods.
ALTER TABLE "products" ADD COLUMN "sellingPrice" DECIMAL(12,2);

-- 3. Stock can now leave through a sale.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'SALE';

-- 4. Buyers.
CREATE TYPE "CustomerType" AS ENUM ('RETAIL', 'WHOLESALE', 'OWN_STORE');

CREATE TABLE "customers" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "type"        "CustomerType" NOT NULL DEFAULT 'RETAIL',
  "phone"       TEXT,
  "email"       TEXT,
  "address"     TEXT,
  "notes"       TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customers_isActive_name_idx" ON "customers"("isActive", "name");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Dispositions.
CREATE TYPE "DispositionType" AS ENUM ('CUSTOMER_SALE', 'STORE_TRANSFER', 'WRITE_OFF');

CREATE TABLE "dispositions" (
  "id"                TEXT NOT NULL,
  "dispositionNumber" TEXT NOT NULL,
  "batchId"           TEXT NOT NULL,
  "productId"         TEXT NOT NULL,
  "type"              "DispositionType" NOT NULL,
  "customerId"        TEXT,
  "quantity"          DECIMAL(14,3) NOT NULL,
  "unitSellingPrice"  DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalRevenue"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unitCogs"          DECIMAL(12,4) NOT NULL,
  "totalCogs"         DECIMAL(14,2) NOT NULL,
  "grossProfit"       DECIMAL(14,2) NOT NULL,
  "costWasFinal"      BOOLEAN NOT NULL DEFAULT false,
  "reason"            TEXT,
  "notes"             TEXT,
  "recordedById"      TEXT NOT NULL,
  "dispositionedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt"        TIMESTAMP(3),
  "reversedById"      TEXT,
  "reversalReason"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dispositions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispositions_dispositionNumber_key" ON "dispositions"("dispositionNumber");
CREATE INDEX "dispositions_productId_dispositionedAt_idx" ON "dispositions"("productId", "dispositionedAt");
CREATE INDEX "dispositions_customerId_idx" ON "dispositions"("customerId");
CREATE INDEX "dispositions_type_idx" ON "dispositions"("type");
CREATE INDEX "dispositions_batchId_idx" ON "dispositions"("batchId");

ALTER TABLE "dispositions"
  ADD CONSTRAINT "dispositions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispositions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispositions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "dispositions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispositions_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
