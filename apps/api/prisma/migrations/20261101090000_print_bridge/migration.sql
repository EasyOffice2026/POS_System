-- Printing without the browser (docs/specs/028-print-bridge.md): the receipts and slips a till
-- leaves for the branch's print bridge, and the key the bridge signs in with.

-- CreateEnum
CREATE TYPE "print_job_kind" AS ENUM ('receipt', 'bill', 'kitchen');

-- CreateEnum
CREATE TYPE "print_job_status" AS ENUM ('queued', 'printing', 'done', 'failed');

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "kind" "print_job_kind" NOT NULL,
    "status" "print_job_status" NOT NULL DEFAULT 'queued',
    "order_number" INTEGER,
    "image" BYTEA NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_bridge_keys" (
    "branch_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_bridge_keys_pkey" PRIMARY KEY ("branch_id")
);

-- CreateIndex
CREATE INDEX "print_jobs_branch_id_status_created_at_idx" ON "print_jobs"("branch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "print_bridge_keys_key_hash_key" ON "print_bridge_keys"("key_hash");

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_bridge_keys" ADD CONSTRAINT "print_bridge_keys_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A picture is never empty, and a job is only "taken" or finished with the time it happened.
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_state_check" CHECK (
    octet_length("image") > 0
    AND "attempts" >= 0
    AND ("status" <> 'queued' OR "finished_at" IS NULL)
    AND ("status" <> 'printing' OR ("claimed_at" IS NOT NULL AND "finished_at" IS NULL))
    AND ("status" NOT IN ('done', 'failed') OR "finished_at" IS NOT NULL)
);
