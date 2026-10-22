-- Delivery orders (docs/specs/026-order-types.md): a third order type, and the customer's phone and
-- address kept on the order. Orders made before have none.

-- AlterEnum
ALTER TYPE "order_type" ADD VALUE 'delivery';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery" JSONB;
