-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('new', 'preparing', 'ready', 'done');

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "ticket_id" UUID;

-- CreateTable
CREATE TABLE "kitchen_tickets" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'new',
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_tickets_branch_id_status_sent_at_idx" ON "kitchen_tickets"("branch_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "kitchen_tickets_order_id_idx" ON "kitchen_tickets"("order_id");

-- CreateIndex
CREATE INDEX "order_lines_ticket_id_idx" ON "order_lines"("ticket_id");

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "kitchen_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_order_id_branch_id_brand_id_fkey" FOREIGN KEY ("order_id", "branch_id", "brand_id") REFERENCES "orders"("id", "branch_id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/008-kitchen-display.md): a finished ticket has the
-- time it was finished, a ready one the time it was ready, and only a sent line is on a ticket.
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_times_check"
  CHECK (("status" = 'done') = ("done_at" IS NOT NULL)
     AND ("status" NOT IN ('ready', 'done') OR "ready_at" IS NOT NULL));
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_ticket_check"
  CHECK ("ticket_id" IS NULL OR "sent_at" IS NOT NULL);
