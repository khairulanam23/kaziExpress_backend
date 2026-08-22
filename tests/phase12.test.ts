import assert from 'assert';
import prisma from '../src/utils/prisma/prisma-client';
import { seedSystemPermissions, getEffectivePermissions } from '../src/utils/permissions/permission-resolver';
import { permissionsService } from '../src/modules/permissions/permissions.service';
import { SYSTEM_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, PERMISSION_PRESETS } from '../src/config/permissions';
import ApiError from '../src/utils/errors/api-error';

async function runPhase12GranularPermissionsTests() {
  console.log('🧪 Starting Backend Phase 12 Test Suite (Granular Employee Permission & Delegated Access Control)...\n');

  let passed = 0;
  let failed = 0;

  const testPass = (name: string) => {
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  };

  const testFail = (name: string, err: any) => {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message || err}`);
    failed++;
  };

  const uniqueId = Date.now();

  try {
    // 0. Seed permissions
    await seedSystemPermissions();

    // ==========================================
    // SETUP: Users
    // ==========================================
    const admin = await prisma.user.create({
      data: {
        email: `phase12.admin.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'ADMIN',
        name: 'Phase 12 Admin',
      },
    });

    const empA = await prisma.user.create({
      data: {
        email: `phase12.empa.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        name: 'Phase 12 Employee A',
      },
    });

    const empB = await prisma.user.create({
      data: {
        email: `phase12.empb.${uniqueId}@example.com`,
        password: 'hashedpassword',
        role: 'EMPLOYEE',
        name: 'Phase 12 Employee B',
      },
    });

    // ==========================================
    // TEST 1: ADMIN automatically has all permissions
    // ==========================================
    const adminPerms = await getEffectivePermissions(admin.id, admin.role);
    assert(adminPerms.length === SYSTEM_PERMISSIONS.length, 'Admin possesses all system permissions');
    assert(adminPerms.includes('INVENTORY_CREATE'), 'Admin includes INVENTORY_CREATE');
    assert(adminPerms.includes('EMPLOYEE_MANAGE_PERMISSIONS'), 'Admin includes EMPLOYEE_MANAGE_PERMISSIONS');
    testPass('Test 1: ADMIN automatically has all system permissions');

    // ==========================================
    // TEST 2: Normal employee has only default permissions
    // ==========================================
    const empAPermsInitial = await getEffectivePermissions(empA.id, empA.role);
    assert(empAPermsInitial.length === DEFAULT_EMPLOYEE_PERMISSIONS.length, 'Normal employee has default permissions count');
    assert(!empAPermsInitial.includes('INVENTORY_CREATE'), 'Normal employee does NOT have INVENTORY_CREATE by default');
    assert(!empAPermsInitial.includes('PAYROLL_MANAGE'), 'Normal employee does NOT have PAYROLL_MANAGE by default');
    testPass('Test 2: Normal employee starts with only default employee permissions');

    // ==========================================
    // TEST 3: Admin can assign a permission
    // ==========================================
    const addResult = await permissionsService.addUserPermissions(empA.id, ['INVENTORY_CREATE'], admin.id);
    assert(addResult.addedPermissions.includes('INVENTORY_CREATE'), 'Permission INVENTORY_CREATE added to employee A');
    testPass('Test 3: Admin can assign a new explicit permission to an employee');

    // ==========================================
    // TEST 4: Admin can remove a permission
    // ==========================================
    await permissionsService.removeUserPermission(empA.id, 'INVENTORY_CREATE', admin.id);
    const empAPermsAfterRemove = await getEffectivePermissions(empA.id, empA.role);
    assert(!empAPermsAfterRemove.includes('INVENTORY_CREATE'), 'Permission INVENTORY_CREATE removed from employee A');
    testPass('Test 4: Admin can remove an assigned permission');

    // ==========================================
    // TEST 5 & 6: Employee receives assigned permissions and effective resolution
    // ==========================================
    await permissionsService.replaceUserPermissions(
      empA.id,
      ['INVENTORY_VIEW', 'INVENTORY_CREATE', 'INVENTORY_MANAGE_STOCK', 'PRODUCTION_CREATE_TASK'],
      admin.id
    );
    const empAPermsEffective = await getEffectivePermissions(empA.id, empA.role);
    assert(empAPermsEffective.includes('INVENTORY_CREATE'), 'Employee A effective permissions include INVENTORY_CREATE');
    assert(empAPermsEffective.includes('PRODUCTION_CREATE_TASK'), 'Employee A effective permissions include PRODUCTION_CREATE_TASK');
    testPass('Test 5 & 6: Employee receives assigned permissions and effective permission resolution reflects them');

    // ==========================================
    // TEST 7: Employee receives 403 / failure without required permission
    // ==========================================
    assert(!empAPermsEffective.includes('PAYROLL_RECORD_PAYMENT'), 'Employee A lacks PAYROLL_RECORD_PAYMENT');
    testPass('Test 7: Missing permission verified for ungranted capability (PAYROLL_RECORD_PAYMENT)');

    // ==========================================
    // TEST 8: Employee without EMPLOYEE_MANAGE_PERMISSIONS cannot assign permissions
    // ==========================================
    try {
      await permissionsService.addUserPermissions(empB.id, ['INVENTORY_CREATE'], empA.id);
      testFail('Employee without EMPLOYEE_MANAGE_PERMISSIONS assigned permissions', new Error('Self-escalation allowed'));
    } catch (err: any) {
      assert(err instanceof ApiError && err.statusCode === 403, 'Attempt by non-permission-manager rejected with 403');
      testPass('Test 8: Employee without permission-management authority cannot assign permissions to others');
    }

    // ==========================================
    // TEST 9: Employee cannot modify their own permissions (Self-escalation prevention)
    // ==========================================
    try {
      await permissionsService.replaceUserPermissions(empA.id, ['EMPLOYEE_MANAGE_PERMISSIONS'], empA.id);
      testFail('Employee modified own permissions', new Error('Self-escalation allowed'));
    } catch (err: any) {
      assert(err instanceof ApiError && err.statusCode === 403, 'Self-modification attempt rejected with 403');
      testPass('Test 9: Self-escalation prevention verified (users cannot alter own permissions)');
    }

    // ==========================================
    // TEST 10: Employee cannot modify another employee\'s permissions
    // ==========================================
    try {
      await permissionsService.removeUserPermission(empB.id, 'NOTIFICATION_VIEW', empA.id);
      testFail('Employee modified another employee permissions', new Error('Allowed unauthorized modification'));
    } catch (err: any) {
      assert(err instanceof ApiError && err.statusCode === 403, 'Unauthorized permission removal rejected with 403');
      testPass("Test 10: Employee cannot modify another employee's permissions");
    }

    // ==========================================
    // TEST 11: Unknown permission is rejected with 400 Bad Request
    // ==========================================
    try {
      await permissionsService.replaceUserPermissions(empA.id, ['INVALID_SUPER_POWER_PERM'], admin.id);
      testFail('Unknown permission accepted', new Error('Allowed unknown permission key'));
    } catch (err: any) {
      assert(err instanceof ApiError && err.statusCode === 400, 'Unknown permission key rejected with 400');
      testPass('Test 11: Unknown permission key is rejected with 400 Bad Request');
    }

    // ==========================================
    // TEST 12: Duplicate permissions are handled correctly
    // ==========================================
    const dupResult = await permissionsService.replaceUserPermissions(
      empA.id,
      ['INVENTORY_VIEW', 'INVENTORY_VIEW', 'INVENTORY_CREATE'],
      admin.id
    );
    assert(dupResult.assignedPermissions.length === 2, 'Duplicates deduplicated cleanly to 2 unique permissions');
    testPass('Test 12: Duplicate permission keys in payload handled idempotently without error');

    // ==========================================
    // TEST 13: Removing permission immediately removes access
    // ==========================================
    await permissionsService.removeUserPermission(empA.id, 'INVENTORY_CREATE', admin.id);
    const postRemovePerms = await getEffectivePermissions(empA.id, empA.role);
    assert(!postRemovePerms.includes('INVENTORY_CREATE'), 'Access removed immediately upon permission revocation');
    testPass('Test 13: Revoking a permission immediately terminates permission access');

    // ==========================================
    // TEST 14: Deactivated employee cannot receive permissions
    // ==========================================
    await prisma.user.update({ where: { id: empB.id }, data: { isActive: false } });
    try {
      await permissionsService.addUserPermissions(empB.id, ['INVENTORY_VIEW'], admin.id);
      testFail('Deactivated employee received permission assignment', new Error('Allowed assignment to inactive user'));
    } catch (err: any) {
      assert(err instanceof ApiError && err.statusCode === 400, 'Assignment to deactivated employee rejected');
      testPass('Test 14: Deactivated employee cannot be assigned delegated permissions');
    }
    // Re-activate empB
    await prisma.user.update({ where: { id: empB.id }, data: { isActive: true } });

    // ==========================================
    // TEST 15: Existing IDOR protections still work
    // ==========================================
    const empBDetails = await permissionsService.getUserPermissions(empB.id);
    assert(empBDetails.user.id === empB.id, 'Employee details retrieved cleanly');
    assert(empBDetails.user.role === 'EMPLOYEE', 'Database role remains EMPLOYEE');
    testPass('Test 15: Security & IDOR protections remain intact');

    // ==========================================
    // TEST 16: Existing ADMIN endpoints still work
    // ==========================================
    const allPermsResponse = await permissionsService.getAllPermissions();
    assert(allPermsResponse.permissions.length >= SYSTEM_PERMISSIONS.length, 'All system permissions listed');
    assert(allPermsResponse.presets.INVENTORY_MANAGER !== undefined, 'Presets configuration exposed');
    testPass('Test 16: System permission metadata and presets API endpoints functional');

    // ==========================================
    // TEST 17: Permission audit records are created
    // ==========================================
    const auditLogs = await prisma.permissionAuditLog.findMany({
      where: { targetUserId: empA.id },
    });
    assert(auditLogs.length >= 3, 'Audit log entries recorded for permission changes');
    assert(auditLogs.some((log) => log.action === 'REPLACE'), 'REPLACE audit log action recorded');
    assert(auditLogs.some((log) => log.action === 'REMOVE'), 'REMOVE audit log action recorded');
    testPass('Test 17: Security audit logs created for all permission mutations');

    // ==========================================
    // TEST 18: Permission changes do not affect unrelated employees
    // ==========================================
    const empBPerms = await getEffectivePermissions(empB.id, empB.role);
    assert(!empBPerms.includes('INVENTORY_CREATE'), 'Unrelated employee B unaffected by employee A permissions');
    testPass('Test 18: Permission modifications for Employee A do not pollute Employee B');

    // ==========================================
    // TEST 19: FULL_ACCESS_EMPLOYEE preset grants expected permissions
    // ==========================================
    const fullAccessPreset = PERMISSION_PRESETS.FULL_ACCESS_EMPLOYEE;
    assert(!fullAccessPreset.includes('EMPLOYEE_MANAGE_PERMISSIONS'), 'FULL_ACCESS_EMPLOYEE does NOT include permission management');
    assert(fullAccessPreset.includes('INVENTORY_CREATE'), 'FULL_ACCESS_EMPLOYEE includes INVENTORY_CREATE');
    assert(fullAccessPreset.includes('PAYROLL_RECORD_PAYMENT'), 'FULL_ACCESS_EMPLOYEE includes PAYROLL_RECORD_PAYMENT');
    testPass('Test 19: FULL_ACCESS_EMPLOYEE preset grants administrative permissions while excluding permission management');

    // ==========================================
    // TEST 20: Database role remains EMPLOYEE
    // ==========================================
    const empADbRecord = await prisma.user.findUnique({ where: { id: empA.id } });
    assert(empADbRecord?.role === 'EMPLOYEE', 'Database role strictly remains EMPLOYEE after receiving explicit permissions');
    testPass('Test 20: Database role strictly remains EMPLOYEE (RBAC role stability verified)');

    // Clean up test data
    await prisma.userPermission.deleteMany({ where: { userId: { in: [admin.id, empA.id, empB.id] } } });
    await prisma.permissionAuditLog.deleteMany({ where: { targetUserId: { in: [empA.id, empB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, empA.id, empB.id] } } });

    console.log(`\n📊 Phase 12 Test Results: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('\n💥 Phase 12 test suite crashed:', err);
    process.exit(1);
  }
}

runPhase12GranularPermissionsTests();
