import assert from 'assert';
import fs from 'fs';
import path from 'path';

/**
 * Real-time sync contract.
 *
 * Every write announces itself over Socket.io as `db:changed { model }`, and the
 * frontend turns that model name into the React Query keys it should refetch.
 * The two halves live in different repositories, so nothing but this test stops
 * them drifting apart — and when they drift, the symptom is silent: a screen
 * that keeps showing data the database no longer holds.
 *
 * Guards three things:
 *   1. every Prisma model maps to at least one query key;
 *   2. every key named in the map is one a query actually uses;
 *   3. transactional writes announce themselves only after the commit.
 */
async function runPhase13SyncContractTests() {
  console.log('🧪 Starting Backend Phase 13 Test Suite (Real-Time Sync Contract)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  try {
    const backendRoot = path.join(__dirname, '..');
    const frontendRoot = path.join(backendRoot, '..', 'Inventory-Management-Frontend-main');
    const socketProviderPath = path.join(frontendRoot, 'src', 'providers', 'socket-provider.tsx');

    if (!fs.existsSync(socketProviderPath)) {
      console.log('  ⏭️  SKIPPED: frontend checkout not present alongside the backend');
      console.log(`\n📊 Phase 13 Test Results: ${passed} Passed, 0 Failed`);
      return;
    }

    // ── The two sides of the contract ────────────────────────────────────────
    const schema = fs.readFileSync(path.join(backendRoot, 'prisma', 'schema.prisma'), 'utf-8');
    const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1].toLowerCase());
    assert(models.length > 0, 'Prisma schema declares models');

    const providerSource = fs.readFileSync(socketProviderPath, 'utf-8');
    const mapBody = providerSource.slice(
      providerSource.indexOf('MODEL_QUERY_KEYS'),
      providerSource.indexOf('function resolveSocketUrl'),
    );
    const mapped: Record<string, string[]> = {};
    for (const entry of mapBody.matchAll(/^\s{2}(\w+):\s*\[([^\]]*)\]/gm)) {
      mapped[entry[1]] = [...entry[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]);
    }
    assert(Object.keys(mapped).length > 0, 'socket-provider exposes a parseable MODEL_QUERY_KEYS');

    // Query keys the frontend actually reads from.
    const hooksDir = path.join(frontendRoot, 'src', 'hooks', 'queries');
    const searchRoots = [hooksDir, path.join(frontendRoot, 'src', 'features')];
    const usedKeys = new Set<string>();
    const constants: Record<string, string> = {};
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf-8');
          for (const c of src.matchAll(/const\s+(\w*KEY)\s*=\s*\[\s*"([^"]+)"/g)) constants[c[1]] = c[2];
          for (const q of src.matchAll(/queryKey:\s*\[\s*(?:\.\.\.)?([A-Z_]*KEY|"[^"]+")/g)) {
            const token = q[1];
            usedKeys.add(token.startsWith('"') ? token.slice(1, -1) : constants[token]);
          }
        }
      }
    };
    walk(hooksDir);
    walk(path.join(frontendRoot, 'src', 'features'));
    usedKeys.delete(undefined as unknown as string);
    assert(usedKeys.size > 0, 'frontend query keys are discoverable');

    // TEST 1: no model changes data without telling anyone.
    const unannounced = models.filter((m) => !mapped[m]);
    assert(
      unannounced.length === 0,
      `Prisma models missing from MODEL_QUERY_KEYS (their writes would never refresh any screen): ${unannounced.join(', ')}`,
    );
    testPass(`All ${models.length} Prisma models map to at least one query key`);

    // TEST 2: no map entry points at a key nothing uses.
    const dead: string[] = [];
    for (const [model, keys] of Object.entries(mapped)) {
      for (const key of keys) if (!usedKeys.has(key)) dead.push(`${model} -> "${key}"`);
    }
    assert(dead.length === 0, `MODEL_QUERY_KEYS references query keys no hook uses: ${dead.join(', ')}`);
    testPass('Every query key named in MODEL_QUERY_KEYS is one a query actually uses');

    // TEST 3: a permission change must refresh the affected user's own session,
    // otherwise their sidebar keeps offering the old set of destinations.
    assert(mapped.userpermission?.includes('auth'), 'userpermission invalidates the cached session');
    assert(mapped.userpermission?.includes('permissions'), 'userpermission invalidates the permission views');
    testPass('Permission changes refresh the affected session (["auth", "me"])');

    // TEST 4: announcements made inside a transaction wait for the commit.
    const clientSource = fs.readFileSync(
      path.join(backendRoot, 'src', 'utils', 'prisma', 'prisma-client.ts'),
      'utf-8',
    );
    assert(clientSource.includes('AsyncLocalStorage'), 'prisma-client tracks transaction scope');
    assert(clientSource.includes('transactionScope.getStore()'), 'writes check whether they are inside a transaction');
    assert(
      /\$transaction\s*=\s*\(/.test(clientSource) && clientSource.includes('flush(buffer)'),
      '$transaction flushes buffered announcements after it resolves',
    );
    testPass('Transactional writes announce changes only after the commit');

    console.log(`\n📊 Phase 13 Test Results: ${passed} Passed, 0 Failed`);
  } catch (err: any) {
    console.error('\n💥 Phase 13 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase13SyncContractTests();
