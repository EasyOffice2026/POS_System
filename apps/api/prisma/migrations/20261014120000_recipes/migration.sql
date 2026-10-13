-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "item_id" UUID,
    "modifier_id" UUID,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_lines_brand_id_idx" ON "recipe_lines"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_item_id_ingredient_id_key" ON "recipe_lines"("item_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_modifier_id_ingredient_id_key" ON "recipe_lines"("modifier_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifiers_id_brand_id_key" ON "modifiers"("id", "brand_id");

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_item_id_brand_id_fkey" FOREIGN KEY ("item_id", "brand_id") REFERENCES "menu_items"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_modifier_id_brand_id_fkey" FOREIGN KEY ("modifier_id", "brand_id") REFERENCES "modifiers"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A recipe line belongs to a dish or to a modifier, never both, and uses more than nothing.
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_owner_check" CHECK (("item_id" IS NULL) <> ("modifier_id" IS NULL));
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_quantity_check" CHECK ("quantity" > 0);

-- Sales may take the stock of a branch below zero (spec 013, rule 5).
ALTER TABLE "branch_stock" DROP CONSTRAINT "branch_stock_quantity_check";
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_after_check";
