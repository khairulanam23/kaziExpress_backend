import assert from 'assert';
import fs from 'fs';
import path from 'path';
import prisma from '../src/utils/prisma/prisma-client';
import config from '../src/config/config';
import { storageProvider } from '../src/utils/storage/storage.service';

/**
 * Media storage: what gets written into the database, and what does not.
 *
 * The bug this guards against was not a crash. Uploads recorded
 * `${BASE_URL}:${PORT}/uploads/<file>`, so with the default `http://localhost`
 * every stored URL pointed at whichever machine was *reading* the row. Against
 * a shared database that silently broke every image on every other host, and
 * no later fix to BASE_URL could repair rows already written.
 *
 * So the assertions are about the *shape* of what is persisted, not about a
 * request succeeding.
 */
async function runPhase17Tests() {
  console.log('🧪 Starting Backend Phase 17 Test Suite (Media Storage)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const stamp = Date.now();
  const written: string[] = [];

  try {
    // ── A stored local URL must never carry a hostname ─────────────────────
    if (config.STORAGE_PROVIDER === 'local') {
      // A 1x1 PNG is enough: this asserts the returned shape, not image handling.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const result = await storageProvider.uploadFile({
        name: `p17-${stamp}.png`,
        data: png,
        mimetype: 'image/png',
      });
      written.push(result.imageStorageId);

      assert.ok(
        result.imageUrl.startsWith('/uploads/'),
        `local uploads must be stored host-relative, got "${result.imageUrl}"`,
      );
      testPass('local upload returns a host-relative path');

      assert.ok(
        !/^https?:\/\//i.test(result.imageUrl),
        `stored URL must not be absolute, got "${result.imageUrl}"`,
      );
      assert.ok(
        !result.imageUrl.includes('localhost'),
        `stored URL must not name a host, got "${result.imageUrl}"`,
      );
      testPass('stored URL names no host');

      const onDisk = path.resolve(__dirname, '..', 'public', 'uploads', result.imageStorageId);
      assert.ok(fs.existsSync(onDisk), 'uploaded file should exist on disk');
      testPass('upload lands in the served directory');

      await storageProvider.deleteFile(result.imageStorageId);
      assert.ok(!fs.existsSync(onDisk), 'deleteFile should remove the file');
      testPass('deleteFile removes the file');
      written.pop();
    } else {
      console.log('  ℹ️  STORAGE_PROVIDER is not "local" — skipping local-lane assertions');
    }

    // ── No row in the database may carry a localhost URL ───────────────────
    // This is the actual production symptom: such a row renders as a broken
    // image for every user, because it resolves against their own machine.
    const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)/i;

    const products = await prisma.product.findMany({
      where: { imageUrl: { not: null } },
      select: { name: true, imageUrl: true },
    });
    const badProducts = products.filter((p) => localhostRe.test(p.imageUrl ?? ''));
    assert.strictEqual(
      badProducts.length,
      0,
      `product.imageUrl rows pointing at localhost: ${badProducts
        .map((p) => `${p.name} (${p.imageUrl})`)
        .join(', ')} — run "npm run repair:media-urls --write"`,
    );
    testPass('no product image points at localhost');

    const users = await prisma.user.findMany({
      where: { avatarUrl: { not: null } },
      select: { email: true, avatarUrl: true },
    });
    const badUsers = users.filter((u) => localhostRe.test(u.avatarUrl ?? ''));
    assert.strictEqual(
      badUsers.length,
      0,
      `user.avatarUrl rows pointing at localhost: ${badUsers.map((u) => u.email).join(', ')}`,
    );
    testPass('no avatar points at localhost');

    const orgs = await prisma.organizationProfile.findMany({
      where: { logoUrl: { not: null } },
      select: { name: true, logoUrl: true },
    });
    const badOrgs = orgs.filter((o) => localhostRe.test(o.logoUrl ?? ''));
    assert.strictEqual(badOrgs.length, 0, 'organisation logo points at localhost');
    testPass('no organisation logo points at localhost');

    // ── Selecting Cloudinary without credentials must fail loudly ──────────
    if (config.STORAGE_PROVIDER === 'cloudinary') {
      assert.ok(config.CLOUDINARY_CLOUD_NAME, 'CLOUDINARY_CLOUD_NAME must be set');
      assert.ok(config.CLOUDINARY_API_KEY, 'CLOUDINARY_API_KEY must be set');
      assert.ok(config.CLOUDINARY_API_SECRET, 'CLOUDINARY_API_SECRET must be set');
      testPass('cloudinary lane has its credentials');
    } else {
      testPass('storage provider resolved without credential errors');
    }

    console.log(`\n🎉 Phase 17 complete — ${passed} assertion group(s) passed.\n`);
  } finally {
    for (const id of written) {
      await storageProvider.deleteFile(id).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

runPhase17Tests().catch((error) => {
  console.error('\n❌ Phase 17 FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
