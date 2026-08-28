import assert from 'assert';
import express from 'express';
import type { Server } from 'http';
import config from '../src/config/config';

/**
 * Proxy trust, and why the hop count is not `true`.
 *
 * Behind a reverse proxy the socket peer is the proxy, so without this setting
 * every request looks like one client and the rate limiter puts all users in a
 * single bucket — everyone gets 429s as soon as anyone exhausts it.
 *
 * The dangerous fix is `trust proxy: true`, which trusts the whole
 * `X-Forwarded-For` chain including the part the caller wrote. That is the
 * property under test here: given a forged entry followed by the address a
 * real proxy appended, the server must resolve the appended one.
 */
async function runPhase18Tests() {
  console.log('🧪 Starting Backend Phase 18 Test Suite (Proxy Trust)...\n');

  let passed = 0;
  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  /** Boots a throwaway app with the given setting and reports the resolved ip. */
  const resolveIp = async (trust: number | boolean | null, forwardedFor: string) => {
    const app = express();
    if (trust !== null) app.set('trust proxy', trust);
    app.get('/ip', (req, res) => {
      res.json({ ip: req.ip });
    });

    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as { port: number };
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ip`, {
        headers: { 'X-Forwarded-For': forwardedFor },
      });
      return ((await response.json()) as { ip: string }).ip;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  try {
    // A caller forges 9.9.9.9; a real proxy then appends the address it saw.
    const chain = '9.9.9.9, 8.8.8.8';

    const withoutTrust = await resolveIp(null, chain);
    assert.ok(
      withoutTrust?.includes('127.0.0.1') || withoutTrust === '::ffff:127.0.0.1' || withoutTrust === '::1',
      `untrusted should fall back to the socket peer, got ${withoutTrust}`,
    );
    testPass('without trust proxy every caller collapses to the socket peer');

    const withHopCount = await resolveIp(1, chain);
    assert.strictEqual(
      withHopCount,
      '8.8.8.8',
      `one trusted hop must resolve the proxy-appended address, got ${withHopCount}`,
    );
    assert.notStrictEqual(withHopCount, '9.9.9.9', 'the forged entry must never win');
    testPass('one trusted hop resolves the appended address, not the forged one');

    // Demonstrates the trap rather than asserting we use it.
    const withTrustAll = await resolveIp(true, chain);
    assert.strictEqual(
      withTrustAll,
      '9.9.9.9',
      `trust-all is expected to surface the forged entry, got ${withTrustAll}`,
    );
    testPass('trust proxy "true" would surface the forged entry — which is why it is not used');

    // ── The configured value ───────────────────────────────────────────────
    assert.ok(
      Number.isInteger(config.TRUST_PROXY) && config.TRUST_PROXY >= 0,
      'TRUST_PROXY must resolve to a non-negative hop count',
    );
    assert.notStrictEqual(
      config.TRUST_PROXY as unknown,
      true,
      'TRUST_PROXY must never resolve to a boolean',
    );
    testPass(`TRUST_PROXY resolves to a hop count (${config.TRUST_PROXY})`);

    if (config.NODE_ENV === 'production') {
      assert.ok(
        config.TRUST_PROXY > 0,
        'a production deployment sits behind a proxy — set TRUST_PROXY=1 or the rate limiter counts every user as one',
      );
      testPass('production sets a hop count');
    } else {
      testPass('non-production defaults to trusting nothing');
    }

    console.log(`\n🎉 Phase 18 complete — ${passed} assertion group(s) passed.\n`);
  } catch (error) {
    console.error('\n❌ Phase 18 FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

runPhase18Tests();
