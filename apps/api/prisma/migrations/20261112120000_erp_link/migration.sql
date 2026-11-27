-- The link with the ERP (docs/specs/029-erp-link.md): the keys it reads the accounting figures
-- with, and the single sign-on tickets already used.

-- CreateTable
CREATE TABLE "integration_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_redemptions" (
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_redemptions_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_keys_key_hash_key" ON "integration_keys"("key_hash");

-- CreateIndex
CREATE INDEX "sso_redemptions_expires_at_idx" ON "sso_redemptions"("expires_at");
