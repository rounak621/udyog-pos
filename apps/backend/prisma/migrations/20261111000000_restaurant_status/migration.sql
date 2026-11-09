-- Hosted mode: restaurant status and free trial. Existing restaurants become
-- ACTIVE through the column default, so nothing already running is locked.
CREATE TYPE "RestaurantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

ALTER TABLE "restaurants" ADD COLUMN "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "restaurants" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "restaurants" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "restaurants" ADD COLUMN "suspendedReason" TEXT;
