-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "received_price" DECIMAL(12,3),
ADD COLUMN     "received_quantity" DECIMAL(15,3),
ADD COLUMN     "received_total" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "invoice_number" TEXT,
ADD COLUMN     "receive_note" TEXT,
ADD COLUMN     "received_at" TIMESTAMPTZ(3),
ADD COLUMN     "received_by_id" UUID,
ADD COLUMN     "received_by_name" TEXT,
ADD COLUMN     "received_total" DECIMAL(12,3);


-- Rules the database keeps as well (docs/specs/019-goods-receipt.md): what arrived is never below
-- zero, and only a received order has a time of receipt.
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_received_check" CHECK (("received_quantity" IS NULL OR "received_quantity" >= 0) AND ("received_price" IS NULL OR "received_price" >= 0));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_received_check" CHECK (("status"::text = 'received') = ("received_at" IS NOT NULL));
