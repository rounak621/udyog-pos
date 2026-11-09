-- India GST invoice: buyer GSTIN and place of supply on the order. Additive and nullable: existing rows and old code are unaffected.
ALTER TABLE "orders" ADD COLUMN "customerGstin" TEXT;
ALTER TABLE "orders" ADD COLUMN "placeOfSupplyStateCode" TEXT;
