-- Platform admin (UDYOG staff): instance-wide features (backup, sync, updates). Additive with a default: existing users stay non-admin.
ALTER TABLE "users" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
