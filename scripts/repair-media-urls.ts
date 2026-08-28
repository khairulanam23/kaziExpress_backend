/**
 * Repairs media references left behind by the old absolute-URL storage scheme.
 *
 * The local storage lane used to write `${BASE_URL}:${PORT}/uploads/<file>`
 * into the database. With `BASE_URL=http://localhost` that produced rows every
 * client resolved against its *own* machine, and because the database is
 * shared (Neon) while the files are not, the rows outlived the files. Uploads
 * now store a host-relative `/uploads/<file>`, but existing rows still hold
 * the old absolute form.
 *
 * Three outcomes per row:
 *   RELATIVISE  absolute URL whose file is still on this disk → `/uploads/...`
 *   CLEAR       file is gone (or the URL points at a host we cannot serve)
 *               → null, so the UI shows its initials fallback instead of a
 *                 broken image
 *   KEEP        already relative, or an absolute Cloudinary/CDN address
 *
 * Dry by default, matching `backfill:batch-costs`. Pass `--write` to apply.
 *
 *   npx ts-node --transpile-only scripts/repair-media-urls.ts
 *   npx ts-node --transpile-only scripts/repair-media-urls.ts --write
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const write = process.argv.includes('--write');

const UPLOAD_DIR = path.resolve(__dirname, '..', 'public', 'uploads');

type Action = 'KEEP' | 'RELATIVISE' | 'CLEAR';

/** Decides what should happen to one stored URL. */
function classify(url: string | null): { action: Action; next: string | null } {
  if (!url || !url.trim()) return { action: 'KEEP', next: url };
  const value = url.trim();

  // Already the new shape.
  if (value.startsWith('/uploads/')) {
    const file = value.slice('/uploads/'.length);
    return fs.existsSync(path.join(UPLOAD_DIR, file))
      ? { action: 'KEEP', next: value }
      : { action: 'CLEAR', next: null };
  }

  // Absolute. Anything that is not one of our own /uploads/ paths is a CDN
  // address (Cloudinary) and is correct to keep whole.
  const match = value.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/i);
  if (!match) return { action: 'KEEP', next: value };

  const relative = match[1];
  const file = relative.slice('/uploads/'.length);
  return fs.existsSync(path.join(UPLOAD_DIR, file))
    ? { action: 'RELATIVISE', next: relative }
    : { action: 'CLEAR', next: null };
}

interface Target {
  label: string;
  rows: Array<{ id: string; name: string; url: string | null }>;
  clear: (id: string) => Promise<unknown>;
  set: (id: string, next: string) => Promise<unknown>;
}

async function collect(): Promise<Target[]> {
  const products = await prisma.product.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, name: true, imageUrl: true },
  });
  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  const orgs = await prisma.organizationProfile.findMany({
    where: { logoUrl: { not: null } },
    select: { id: true, name: true, logoUrl: true },
  });

  return [
    {
      label: 'product.imageUrl',
      rows: products.map((p) => ({ id: p.id, name: p.name, url: p.imageUrl })),
      // The storage id is cleared alongside the URL: keeping it would point a
      // later delete at a file that is not there.
      clear: (id) =>
        prisma.product.update({ where: { id }, data: { imageUrl: null, imageStorageId: null } }),
      set: (id, next) => prisma.product.update({ where: { id }, data: { imageUrl: next } }),
    },
    {
      label: 'user.avatarUrl',
      rows: users.map((u) => ({ id: u.id, name: u.name ?? u.email, url: u.avatarUrl })),
      clear: (id) =>
        prisma.user.update({ where: { id }, data: { avatarUrl: null, avatarStorageId: null } }),
      set: (id, next) => prisma.user.update({ where: { id }, data: { avatarUrl: next } }),
    },
    {
      label: 'organizationProfile.logoUrl',
      rows: orgs.map((o) => ({ id: o.id, name: o.name, url: o.logoUrl })),
      clear: (id) =>
        prisma.organizationProfile.update({
          where: { id },
          data: { logoUrl: null, logoStorageId: null },
        }),
      set: (id, next) =>
        prisma.organizationProfile.update({ where: { id }, data: { logoUrl: next } }),
    },
  ];
}

async function main() {
  console.log(write ? '── APPLYING changes\n' : '── DRY RUN (pass --write to apply)\n');
  console.log(`Upload directory: ${UPLOAD_DIR}`);
  console.log(`Exists: ${fs.existsSync(UPLOAD_DIR)}\n`);

  const totals: Record<Action, number> = { KEEP: 0, RELATIVISE: 0, CLEAR: 0 };

  for (const target of await collect()) {
    console.log(`▸ ${target.label} (${target.rows.length} row(s) with a value)`);
    for (const row of target.rows) {
      const { action, next } = classify(row.url);
      totals[action] += 1;
      if (action === 'KEEP') continue;

      console.log(`   ${action.padEnd(11)} ${row.name}`);
      console.log(`               ${row.url}`);
      console.log(`            -> ${next ?? '(null — image must be re-uploaded)'}`);

      if (!write) continue;
      if (action === 'CLEAR') await target.clear(row.id);
      else if (next) await target.set(row.id, next);
    }
    console.log('');
  }

  console.log('── Summary');
  console.log(`   kept:        ${totals.KEEP}`);
  console.log(`   relativised: ${totals.RELATIVISE}`);
  console.log(`   cleared:     ${totals.CLEAR}`);
  if (!write && totals.RELATIVISE + totals.CLEAR > 0) {
    console.log('\n   Nothing was written. Re-run with --write to apply.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
