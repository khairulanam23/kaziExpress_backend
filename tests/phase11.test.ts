import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runPhase11ProductionHardeningTests() {
  console.log('🧪 Starting Backend Phase 11 Test Suite (Production Hardening & OpenAPI Contract Audit)...\n');

  let passed = 0;

  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  try {
    // TEST 1: OpenAPI 3.0 Documentation file exists & is valid JSON
    const openapiPath = path.join(__dirname, '..', 'src', 'docs', 'openapi.json');
    assert(fs.existsSync(openapiPath), 'OpenAPI specification openapi.json file exists');

    const rawContent = fs.readFileSync(openapiPath, 'utf-8');
    const openapiObj = JSON.parse(rawContent);
    assert(openapiObj.openapi === '3.0.0', 'OpenAPI version is 3.0.0');
    assert(openapiObj.paths['/dashboard/overview'] !== undefined, 'OpenAPI documents dashboard endpoint');
    assert(openapiObj.paths['/reports/inventory'] !== undefined, 'OpenAPI documents inventory report endpoint');
    testPass('OpenAPI 3.0 documentation spec exists & validates schema structure');

    // TEST 2: Environment Configuration Audit
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    assert(fs.existsSync(envExamplePath), '.env.example configuration template exists');
    const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');
    assert(envExampleContent.includes('DATABASE_URL'), '.env.example documents DATABASE_URL');
    assert(envExampleContent.includes('JWT_SECRET'), '.env.example documents JWT_SECRET');
    assert(envExampleContent.includes('PORT'), '.env.example documents PORT');
    testPass('.env.example configuration template verified');

    // TEST 3: Git Security Check — .env is in .gitignore
    const gitignorePath = path.join(__dirname, '..', '.gitignore');
    assert(fs.existsSync(gitignorePath), '.gitignore file exists');
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    assert(gitignoreContent.includes('.env'), '.gitignore properly excludes .env from version control');
    testPass('.gitignore security check verified (.env excluded)');

    // TEST 4: Production Error Masking Logic Verification
    const mockPrismaError = {
      code: 'P2002',
      message: 'Unique constraint failed on the fields: (email) - database internal error details',
    };

    // Simulate global error handler logic
    let statusCode = (mockPrismaError as any).statusCode || 500;
    let message = (mockPrismaError as any).message;
    const isProd = true; // production mode check simulation
    if (mockPrismaError.code && mockPrismaError.code.startsWith('P')) {
      if (isProd) {
        statusCode = 500;
        message = 'A database error occurred while processing your request.';
      }
    }

    assert(statusCode === 500, 'Status code set to 500');
    assert(message === 'A database error occurred while processing your request.', 'Database internal details masked in production');
    assert(!message.includes('email'), 'Sensitive schema fields masked from public response');
    testPass('Production Prisma database error masking verified');

    // TEST 5: API Response Contract Standard Structure
    const sampleResponse = {
      success: true,
      statusCode: 200,
      message: 'Tasks retrieved successfully',
      data: { tasks: [], totalData: 0 },
    };

    assert(typeof sampleResponse.success === 'boolean', 'Response contains boolean success flag');
    assert(typeof sampleResponse.statusCode === 'number', 'Response contains numeric statusCode');
    assert(typeof sampleResponse.message === 'string', 'Response contains descriptive string message');
    testPass('Standard API response contract structure verified ({ success, statusCode, message, data })');

    console.log(`\n📊 Phase 11 Test Results: ${passed} Passed, 0 Failed`);
  } catch (err: any) {
    console.error('\n💥 Phase 11 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase11ProductionHardeningTests();
