-- India sales invoice numbers (PREFIX/FYSHORT/NNNNNN). Additive only: new nullable
-- columns and a new table. Existing orders keep invoiceNo NULL (no backfill).

-- AlterTable
ALTER TABLE "branches" ADD COLUMN "invoicePrefix" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "invoiceIssuedAt" TIMESTAMP(3),
ADD COLUMN "invoiceNo" TEXT,
ADD COLUMN "invoiceRestaurantId" TEXT,
ADD COLUMN "invoiceSeriesId" TEXT;

-- CreateTable
CREATE TABLE "invoice_series" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "fyShort" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_series_branchId_financialYear_idx" ON "invoice_series"("branchId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_restaurantId_prefix_financialYear_key" ON "invoice_series"("restaurantId", "prefix", "financialYear");

-- CreateIndex (NULLs never conflict: orders without a number are unaffected)
CREATE UNIQUE INDEX "orders_invoiceRestaurantId_invoiceNo_key" ON "orders"("invoiceRestaurantId", "invoiceNo");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoiceSeriesId_fkey" FOREIGN KEY ("invoiceSeriesId") REFERENCES "invoice_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
