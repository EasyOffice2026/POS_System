// Imports a menu file into a brand (docs/rollout.md):
//   npm run menu:import -w @pos/api -- --brand Mudawara --file prisma/menus/mudawara.json
// --brand is the brand's English name or its id. The brand must exist (Brands → Add). Running it
// again updates what changed and makes no copies. It works on whatever DATABASE_URL points at, the
// live database included, so check the brand name first.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { createPrismaClient } from '../src/lib/prisma';
import { importMenu } from './menu-import';

const { values } = parseArgs({
  options: { brand: { type: 'string' }, file: { type: 'string' } },
});
if (!values.brand || !values.file) {
  console.error(
    'Usage: npm run menu:import -w @pos/api -- --brand <name or id> --file <menu.json>',
  );
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);

try {
  const brands = await prisma.brand.findMany();
  const wanted = values.brand.trim().toLowerCase();
  const brand = brands.find(
    (row) =>
      row.id === values.brand ||
      ((row.name as { en?: string }).en ?? '').trim().toLowerCase() === wanted,
  );
  if (!brand) {
    console.error(
      `No brand named "${values.brand}". Brands: ${brands.map((row) => (row.name as { en?: string }).en).join(', ') || 'none'}.`,
    );
    process.exit(1);
  }
  const data: unknown = JSON.parse(await readFile(values.file, 'utf8'));
  const counts = await importMenu(prisma, brand.id, data);
  console.log(
    `Imported into ${(brand.name as { en?: string }).en}: ${counts.categories} categories, ${counts.items} items, ${counts.groups} modifier groups, ${counts.modifiers} modifiers.`,
  );
  console.log('Tills pick up the new menu within a few minutes.');
} finally {
  await prisma.$disconnect();
}
