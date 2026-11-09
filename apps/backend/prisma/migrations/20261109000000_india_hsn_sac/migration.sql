-- India GST: HSN/SAC codes. Additive and nullable: existing rows and old code are unaffected.
ALTER TABLE "branches" ADD COLUMN "defaultHsnSac" TEXT;
ALTER TABLE "menu_items" ADD COLUMN "hsnSac" TEXT;
ALTER TABLE "order_items" ADD COLUMN "hsnSacSnapshot" TEXT;
