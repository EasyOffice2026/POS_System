-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "search_text" TEXT NOT NULL DEFAULT '',
    "base_price" DECIMAL(10,3) NOT NULL,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_menu_items" (
    "branch_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "price_override" DECIMAL(10,3),
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_menu_items_pkey" PRIMARY KEY ("branch_id","item_id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "price_delta" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combos" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "price" DECIMAL(10,3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_slots" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "combo_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "combo_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_slot_options" (
    "slot_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "price_delta" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "combo_slot_options_pkey" PRIMARY KEY ("slot_id","item_id")
);

-- CreateIndex
CREATE INDEX "menu_categories_brand_id_sort_order_idx" ON "menu_categories"("brand_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_id_brand_id_key" ON "menu_categories"("id", "brand_id");

-- CreateIndex
CREATE INDEX "menu_items_brand_id_category_id_idx" ON "menu_items"("brand_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_id_brand_id_key" ON "menu_items"("id", "brand_id");

-- CreateIndex
CREATE INDEX "branch_menu_items_item_id_idx" ON "branch_menu_items"("item_id");

-- CreateIndex
CREATE INDEX "branch_menu_items_brand_id_idx" ON "branch_menu_items"("brand_id");

-- CreateIndex
CREATE INDEX "modifier_groups_item_id_idx" ON "modifier_groups"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_id_brand_id_key" ON "modifier_groups"("id", "brand_id");

-- CreateIndex
CREATE INDEX "modifiers_group_id_idx" ON "modifiers"("group_id");

-- CreateIndex
CREATE INDEX "combos_brand_id_idx" ON "combos"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "combos_id_brand_id_key" ON "combos"("id", "brand_id");

-- CreateIndex
CREATE INDEX "combo_slots_combo_id_idx" ON "combo_slots"("combo_id");

-- CreateIndex
CREATE UNIQUE INDEX "combo_slots_id_brand_id_key" ON "combo_slots"("id", "brand_id");

-- CreateIndex
CREATE INDEX "combo_slot_options_item_id_idx" ON "combo_slot_options"("item_id");

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_brand_id_fkey" FOREIGN KEY ("category_id", "brand_id") REFERENCES "menu_categories"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_menu_items" ADD CONSTRAINT "branch_menu_items_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_menu_items" ADD CONSTRAINT "branch_menu_items_item_id_brand_id_fkey" FOREIGN KEY ("item_id", "brand_id") REFERENCES "menu_items"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_item_id_brand_id_fkey" FOREIGN KEY ("item_id", "brand_id") REFERENCES "menu_items"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_id_brand_id_fkey" FOREIGN KEY ("group_id", "brand_id") REFERENCES "modifier_groups"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slots" ADD CONSTRAINT "combo_slots_combo_id_brand_id_fkey" FOREIGN KEY ("combo_id", "brand_id") REFERENCES "combos"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slot_options" ADD CONSTRAINT "combo_slot_options_slot_id_brand_id_fkey" FOREIGN KEY ("slot_id", "brand_id") REFERENCES "combo_slots"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_slot_options" ADD CONSTRAINT "combo_slot_options_item_id_brand_id_fkey" FOREIGN KEY ("item_id", "brand_id") REFERENCES "menu_items"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the API checks too, kept in the database as well so nothing can write around them.
-- A price is never below zero (a modifier's price change may be), and a modifier group's smallest
-- choice is never larger than its largest.
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_base_price_check" CHECK ("base_price" >= 0);

ALTER TABLE "combos" ADD CONSTRAINT "combos_price_check" CHECK ("price" >= 0);

ALTER TABLE "branch_menu_items" ADD CONSTRAINT "branch_menu_items_price_override_check" CHECK ("price_override" IS NULL OR "price_override" >= 0);

ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_select_range_check" CHECK ("min_select" >= 0 AND "max_select" >= 1 AND "min_select" <= "max_select");
