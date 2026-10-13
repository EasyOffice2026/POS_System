-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "payment_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_prices" (
    "supplier_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "price" DECIMAL(12,3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_prices_pkey" PRIMARY KEY ("supplier_id","ingredient_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_id_brand_id_key" ON "suppliers"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_brand_id_search_text_key" ON "suppliers"("brand_id", "search_text");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_supplier_id_brand_id_fkey" FOREIGN KEY ("supplier_id", "brand_id") REFERENCES "suppliers"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/017-suppliers.md).
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_days_check" CHECK ("payment_days" BETWEEN 0 AND 365);
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_price_check" CHECK ("price" >= 0);
