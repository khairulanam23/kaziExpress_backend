import { PrismaClient, Role, ItemType, TaskStatus, StockMovementType, ProductRequestType, ProductRequestStatus, AttendanceSource, OvertimeStatus, DocumentCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('========================================');
  console.log('Starting 30-Day Inventory Simulation Seed');
  console.log('========================================\n');

  // =========================================================================
  // 1. DELETE EXISTING APPLICATION DATA SAFELY IN DEPENDENCY ORDER
  // =========================================================================
  console.log('⚠️ Clearing existing database...');

  await prisma.permissionAuditLog.deleteMany({});
  await prisma.userPermission.deleteMany({});
  await prisma.permission.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.salaryPayment.deleteMany({});
  await prisma.monthlyPayrollSnapshot.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.productRequest.deleteMany({});
  await prisma.taskBatchAllocation.deleteMany({});
  await prisma.taskRequiredProduct.deleteMany({});
  await prisma.taskAssignment.deleteMany({});
  await prisma.inventoryBatch.deleteMany({});

  // Break self-referencing hierarchy on Tasks before deletion
  await prisma.task.updateMany({ data: { parentTaskId: null } });
  await prisma.task.deleteMany({});

  await prisma.productBOM.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.vendor.deleteMany({});

  await prisma.employeeRecord.deleteMany({});
  await prisma.contentField.deleteMany({});
  await prisma.contentType.deleteMany({});
  await prisma.employeeDocument.deleteMany({});
  await prisma.employeeProfile.deleteMany({});
  await prisma.organizationProfile.deleteMany({});
  await prisma.systemConfig.deleteMany({});
  await prisma.monthlyReport.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('✓ Existing data removed\n');

  // =========================================================================
  // 2. TIME & DATE SIMULATION WINDOW (30-DAY DETERMINISTIC WINDOW)
  // =========================================================================
  const seedEndDateStr = process.env.SEED_END_DATE || '2026-08-22';
  const endDate = new Date(seedEndDateStr);
  const endTimestamp = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  function simDate(dayIndex: number, hour = 9, minute = 0): Date {
    // dayIndex: 1 to 30 (Day 1 is 29 days before endDate)
    const base = new Date(endTimestamp - (30 - dayIndex) * 86400 * 1000);
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute, 0, 0));
  }

  // =========================================================================
  // 3. ADMIN ACCOUNT
  // =========================================================================
  console.log('📦 Creating Admin Account...');
  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: passwordHash,
      role: Role.ADMIN,
      name: 'System Administrator',
      address: '100 Gulshan Avenue, Dhaka-1212',
      phone: '+8801700000000',
      isActive: true,
      createdAt: simDate(1, 8, 0),
    },
  });
  console.log(`✓ Admin created: ${admin.email}`);

  // Organization Profile
  await prisma.organizationProfile.create({
    data: {
      name: 'Kazi Express',
      legalName: 'Kazi Express Limited',
      registrationNumber: 'REG-BD-2024-8890',
      taxId: 'TIN-99482019',
      email: 'info@kaziexpress.com',
      phone: '+88029881122',
      website: 'https://kaziexpress.demo',
      addressLine: 'Plot 42, Tejgaon Industrial Area',
      city: 'Dhaka',
      country: 'Bangladesh',
      updatedById: admin.id,
    },
  });

  // System Configurations
  await prisma.systemConfig.createMany({
    data: [
      { key: 'negative_stock_max_days', value: 7, description: 'Max allowed negative stock days', updatedById: admin.id },
      { key: 'default_pay_calculation_mode', value: 'HOURLY', description: 'Default pay calculation mode', updatedById: admin.id },
      { key: 'default_late_grace_minutes', value: 10, description: 'Grace minutes before late penalty', updatedById: admin.id },
      { key: 'default_overtime_multiplier', value: 1.5, description: 'Default overtime rate multiplier', updatedById: admin.id },
      { key: 'low_stock_alert_enabled', value: true, description: 'Enable low stock notifications', updatedById: admin.id },
      { key: 'auto_generate_monthly_report', value: true, description: 'Auto-generate monthly reports', updatedById: admin.id },
    ],
  });

  // =========================================================================
  // 4. EMPLOYEES & PROFILES
  // =========================================================================
  console.log('📦 Creating 5 Employees & Profiles...');

  const employeeData = [
    {
      email: 'rahim@example.com',
      name: 'Rahim Uddin',
      phone: '+8801711223344',
      address: '24 Mirpur Road, Dhaka',
      department: 'Electrical Assembly',
      designation: 'Senior Assembler',
      hourlyRate: 180,
      joinDate: new Date('2025-01-15'),
    },
    {
      email: 'karim@example.com',
      name: 'Abdul Karim',
      phone: '+8801822334455',
      address: '15 Uttara Sector 4, Dhaka',
      department: 'Mechanical Assembly',
      designation: 'Technician',
      hourlyRate: 220,
      joinDate: new Date('2025-02-01'),
    },
    {
      email: 'tanvir@example.com',
      name: 'Tanvir Ahmed',
      phone: '+8801933445566',
      address: '88 Dhanmondi 27, Dhaka',
      department: 'Quality Control',
      designation: 'QC Inspector',
      hourlyRate: 275,
      joinDate: new Date('2025-03-10'),
    },
    {
      email: 'saiful@example.com',
      name: 'Saiful Islam',
      phone: '+8801544556677',
      address: '50 Mohakhali DOHS, Dhaka',
      department: 'Inventory & Logistics',
      designation: 'Store Officer',
      hourlyRate: 320,
      joinDate: new Date('2025-04-05'),
    },
    {
      email: 'nadia@example.com',
      name: 'Nadia Sultana',
      phone: '+8801655667788',
      address: '12 Badda Link Road, Dhaka',
      department: 'Production Operations',
      designation: 'Production Specialist',
      hourlyRate: 390,
      joinDate: new Date('2025-05-20'),
    },
  ];

  const employees: any[] = [];

  for (const emp of employeeData) {
    const user = await prisma.user.create({
      data: {
        email: emp.email,
        password: passwordHash,
        role: Role.EMPLOYEE,
        name: emp.name,
        phone: emp.phone,
        address: emp.address,
        isActive: true,
        createdAt: simDate(1, 8, 30),
        employeeProfile: {
          create: {
            hourlyRate: emp.hourlyRate,
            payCalculationMode: 'HOURLY',
            overtimeMultiplier: 1.5,
            lateGraceMinutes: 10,
            earlyLeavePenalty: true,
            department: emp.department,
            designation: emp.designation,
            joinDate: emp.joinDate,
          },
        },
      },
      include: { employeeProfile: true },
    });

    // Create Employee Document Record (NID Copy)
    await prisma.employeeDocument.create({
      data: {
        userId: user.id,
        name: `${emp.name} — NID Verification Document`,
        documentType: 'NID',
        category: DocumentCategory.PERSONAL,
        fileStorageId: `demo_storage_nid_${user.id.slice(0, 8)}`,
        isPrivate: true,
        originalFileName: 'nid_card_scan.pdf',
        mimeType: 'application/pdf',
        fileSize: 245000,
        isVerified: true,
        notes: 'Verified against national identity database during onboarding',
        uploadedAt: emp.joinDate,
      },
    });

    employees.push(user);
    console.log(`  ✓ Employee: ${user.name} (${user.email}) — Rate: ${emp.hourlyRate} BDT/hr`);
  }

  // =========================================================================
  // 5. CATEGORIES
  // =========================================================================
  console.log('📦 Creating Categories...');

  const catRaw = await prisma.category.create({
    data: {
      name: 'Raw Materials',
      description: 'Raw material components, parts, hardware, and structural elements for manufacturing',
    },
  });

  const catFinished = await prisma.category.create({
    data: {
      name: 'Finished Products',
      description: 'Assembled finished electronic and industrial control systems ready for deployment',
    },
  });
  console.log('✓ Categories created: Raw Materials, Finished Products');

  // =========================================================================
  // 6. VENDORS
  // =========================================================================
  console.log('📦 Creating Vendors...');

  const vendorDhaka = await prisma.vendor.create({
    data: {
      name: 'Dhaka Industrial Supplies',
      contact: 'Abul Bashar',
      phone: '+8801711000001',
      email: 'info@dhakaindustrial.com',
      address: '12 Tejgaon Industrial Area, Dhaka',
      notes: 'Primary supplier for heavy metals, structural sheets, and wiring',
    },
  });

  const vendorBengal = await prisma.vendor.create({
    data: {
      name: 'Bengal Raw Materials Ltd.',
      contact: 'Nazmul Huda',
      phone: '+8801819000002',
      email: 'sales@bengalraw.com',
      address: '45 BSCIC Industrial Area, Gazipur',
      notes: 'Specialist vendor for plastics, seals, precision bearings, and motors',
    },
  });

  const vendorMetro = await prisma.vendor.create({
    data: {
      name: 'Metro Packaging Solutions',
      contact: 'Shamim Reza',
      phone: '+8801912000003',
      email: 'orders@metropack.com',
      address: '88 Motijheel C/A, Dhaka',
      notes: 'Industrial packaging boxes, hardware fasteners, and adhesives',
    },
  });
  console.log('✓ Vendors created: Dhaka Industrial Supplies, Bengal Raw Materials Ltd., Metro Packaging Solutions');

  // =========================================================================
  // 7. INVENTORY ITEMS (10 COMPONENTS + 5 PRODUCTS)
  // =========================================================================
  console.log('📦 Creating Inventory Items (10 Components & 5 Products)...');

  // COMPONENTS
  const compSteel = await prisma.product.create({
    data: {
      sku: 'COMP-001',
      name: 'Steel Sheet',
      description: 'Heavy duty 2mm galvanized steel sheet for enclosure body',
      itemType: ItemType.COMPONENT,
      unit: 'Sheet',
      unitPrice: 1500.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 20,
      categoryId: catRaw.id,
      vendorId: vendorDhaka.id,
    },
  });

  const compAluminum = await prisma.product.create({
    data: {
      sku: 'COMP-002',
      name: 'Aluminum Rod',
      description: '10mm extruded aluminum rod for frame reinforcement',
      itemType: ItemType.COMPONENT,
      unit: 'Meter',
      unitPrice: 450.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 30,
      categoryId: catRaw.id,
      vendorId: vendorDhaka.id,
    },
  });

  const compPlastic = await prisma.product.create({
    data: {
      sku: 'COMP-003',
      name: 'Plastic Housing',
      description: 'ABS thermoformed plastic housing shell',
      itemType: ItemType.COMPONENT,
      unit: 'Piece',
      unitPrice: 250.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 40,
      categoryId: catRaw.id,
      vendorId: vendorBengal.id,
    },
  });

  const compCopper = await prisma.product.create({
    data: {
      sku: 'COMP-004',
      name: 'Copper Wire',
      description: '4mm insulated multi-strand copper wire',
      itemType: ItemType.COMPONENT,
      unit: 'Meter',
      unitPrice: 120.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 100,
      categoryId: catRaw.id,
      vendorId: vendorDhaka.id,
    },
  });

  const compSeal = await prisma.product.create({
    data: {
      sku: 'COMP-005',
      name: 'Rubber Seal',
      description: 'Weatherproof EPDM rubber gasket seal',
      itemType: ItemType.COMPONENT,
      unit: 'Piece',
      unitPrice: 35.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 50,
      categoryId: catRaw.id,
      vendorId: vendorBengal.id,
    },
  });

  const compBearing = await prisma.product.create({
    data: {
      sku: 'COMP-006',
      name: 'Bearing',
      description: 'High-speed ball bearing 6204-RS',
      itemType: ItemType.COMPONENT,
      unit: 'Piece',
      unitPrice: 180.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 40,
      categoryId: catRaw.id,
      vendorId: vendorBengal.id,
    },
  });

  const compMotor = await prisma.product.create({
    data: {
      sku: 'COMP-007',
      name: 'Motor Unit',
      description: 'Single-phase 1HP induction motor drive',
      itemType: ItemType.COMPONENT,
      unit: 'Piece',
      unitPrice: 3500.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 15,
      categoryId: catRaw.id,
      vendorId: vendorBengal.id,
    },
  });

  const compScrews = await prisma.product.create({
    data: {
      sku: 'COMP-008',
      name: 'Screws',
      description: 'M4 x 15mm stainless steel machine screws (Pack of 50)',
      itemType: ItemType.COMPONENT,
      unit: 'Pack',
      unitPrice: 50.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 50,
      categoryId: catRaw.id,
      vendorId: vendorMetro.id,
    },
  });

  const compBox = await prisma.product.create({
    data: {
      sku: 'COMP-009',
      name: 'Packaging Box',
      description: 'Heavy duty 5-ply corrugated shipping box',
      itemType: ItemType.COMPONENT,
      unit: 'Piece',
      unitPrice: 85.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 60,
      categoryId: catRaw.id,
      vendorId: vendorMetro.id,
    },
  });

  const compGlue = await prisma.product.create({
    data: {
      sku: 'COMP-010',
      name: 'Industrial Glue',
      description: 'High-strength cyanoacrylate adhesive (500ml bottle)',
      itemType: ItemType.COMPONENT,
      unit: 'Bottle',
      unitPrice: 220.0,
      currency: 'BDT',
      currentStock: 0,
      lowStockThreshold: 25,
      categoryId: catRaw.id,
      vendorId: vendorMetro.id,
    },
  });

  // PRODUCTS (Finished Goods)
  const prodControlPanel = await prisma.product.create({
    data: {
      sku: 'PROD-001',
      name: 'Electric Control Panel',
      description: 'Master electrical distribution & control unit with digital display',
      itemType: ItemType.PRODUCT,
      unit: 'Unit',
      unitPrice: 8500.0,
      currency: 'BDT',
      currentStock: 0,
      isComposite: true,
      categoryId: catFinished.id,
    },
  });

  const prodMotorAssembly = await prisma.product.create({
    data: {
      sku: 'PROD-002',
      name: 'Compact Motor Assembly',
      description: 'Pre-assembled motor drive unit with precision bearings & seals',
      itemType: ItemType.PRODUCT,
      unit: 'Unit',
      unitPrice: 5200.0,
      currency: 'BDT',
      currentStock: 0,
      isComposite: true,
      categoryId: catFinished.id,
    },
  });

  const prodSensorUnit = await prisma.product.create({
    data: {
      sku: 'PROD-003',
      name: 'Industrial Sensor Unit',
      description: 'Environmental telemetry & proximity sensor enclosure module',
      itemType: ItemType.PRODUCT,
      unit: 'Unit',
      unitPrice: 3800.0,
      currency: 'BDT',
      currentStock: 0,
      isComposite: true,
      categoryId: catFinished.id,
    },
  });

  const prodDistBox = await prisma.product.create({
    data: {
      sku: 'PROD-004',
      name: 'Power Distribution Box',
      description: 'Heavy duty sub-station power branching box',
      itemType: ItemType.PRODUCT,
      unit: 'Unit',
      unitPrice: 6900.0,
      currency: 'BDT',
      currentStock: 0,
      isComposite: true,
      categoryId: catFinished.id,
    },
  });

  const prodControlModule = await prisma.product.create({
    data: {
      sku: 'PROD-005',
      name: 'Automated Control Module',
      description: 'Programmable logic motorized automation control hub',
      itemType: ItemType.PRODUCT,
      unit: 'Unit',
      unitPrice: 9400.0,
      currency: 'BDT',
      currentStock: 0,
      isComposite: true,
      categoryId: catFinished.id,
    },
  });

  console.log('✓ 10 Components and 5 Products created successfully');

  // =========================================================================
  // 8. BILL OF MATERIALS (BOM)
  // =========================================================================
  console.log('📦 Creating Bill of Materials (BOM) for 5 Products...');

  await prisma.productBOM.createMany({
    data: [
      // PROD-001 Electric Control Panel
      { parentProductId: prodControlPanel.id, childProductId: compSteel.id, quantityRequired: 2.0 },
      { parentProductId: prodControlPanel.id, childProductId: compCopper.id, quantityRequired: 3.0 },
      { parentProductId: prodControlPanel.id, childProductId: compScrews.id, quantityRequired: 8.0 },
      { parentProductId: prodControlPanel.id, childProductId: compPlastic.id, quantityRequired: 1.0 },
      { parentProductId: prodControlPanel.id, childProductId: compGlue.id, quantityRequired: 0.2 },

      // PROD-002 Compact Motor Assembly
      { parentProductId: prodMotorAssembly.id, childProductId: compMotor.id, quantityRequired: 1.0 },
      { parentProductId: prodMotorAssembly.id, childProductId: compAluminum.id, quantityRequired: 2.0 },
      { parentProductId: prodMotorAssembly.id, childProductId: compBearing.id, quantityRequired: 2.0 },
      { parentProductId: prodMotorAssembly.id, childProductId: compSeal.id, quantityRequired: 2.0 },
      { parentProductId: prodMotorAssembly.id, childProductId: compScrews.id, quantityRequired: 6.0 },

      // PROD-003 Industrial Sensor Unit
      { parentProductId: prodSensorUnit.id, childProductId: compPlastic.id, quantityRequired: 1.0 },
      { parentProductId: prodSensorUnit.id, childProductId: compCopper.id, quantityRequired: 2.0 },
      { parentProductId: prodSensorUnit.id, childProductId: compScrews.id, quantityRequired: 4.0 },
      { parentProductId: prodSensorUnit.id, childProductId: compBox.id, quantityRequired: 1.0 },
      { parentProductId: prodSensorUnit.id, childProductId: compGlue.id, quantityRequired: 0.1 },

      // PROD-004 Power Distribution Box
      { parentProductId: prodDistBox.id, childProductId: compSteel.id, quantityRequired: 1.0 },
      { parentProductId: prodDistBox.id, childProductId: compCopper.id, quantityRequired: 5.0 },
      { parentProductId: prodDistBox.id, childProductId: compPlastic.id, quantityRequired: 2.0 },
      { parentProductId: prodDistBox.id, childProductId: compScrews.id, quantityRequired: 10.0 },
      { parentProductId: prodDistBox.id, childProductId: compBox.id, quantityRequired: 1.0 },

      // PROD-005 Automated Control Module
      { parentProductId: prodControlModule.id, childProductId: compMotor.id, quantityRequired: 1.0 },
      { parentProductId: prodControlModule.id, childProductId: compSteel.id, quantityRequired: 1.0 },
      { parentProductId: prodControlModule.id, childProductId: compAluminum.id, quantityRequired: 1.0 },
      { parentProductId: prodControlModule.id, childProductId: compBearing.id, quantityRequired: 2.0 },
      { parentProductId: prodControlModule.id, childProductId: compCopper.id, quantityRequired: 4.0 },
      { parentProductId: prodControlModule.id, childProductId: compScrews.id, quantityRequired: 8.0 },
    ],
  });
  console.log('✓ BOM entries created for all 5 products');

  // =========================================================================
  // 9. INITIAL INVENTORY BATCHES & STOCK MOVEMENTS (DAYS 1, 5, 15, 27)
  // =========================================================================
  console.log('📦 Creating Component Batches & Purchase Stock Movements...');

  const batches: Record<string, any> = {};

  async function createPurchaseBatch(
    batchNumber: string,
    product: any,
    qty: number,
    unitCost: number,
    dayIndex: number,
    notes: string
  ) {
    const batchDate = simDate(dayIndex, 9, 30);
    const batch = await prisma.inventoryBatch.create({
      data: {
        batchNumber,
        productId: product.id,
        initialQuantity: qty,
        remainingQuantity: qty,
        reservedQuantity: 0,
        createdById: admin.id,
        createdAt: batchDate,
      },
    });

    const prevStock = Number(product.currentStock);
    const newStock = prevStock + qty;

    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        batchId: batch.id,
        type: StockMovementType.PURCHASE,
        quantity: qty,
        previousQuantity: prevStock,
        newQuantity: newStock,
        unitCost,
        totalCost: qty * unitCost,
        performedById: admin.id,
        notes,
        createdAt: batchDate,
      },
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { currentStock: newStock },
    });
    product.currentStock = newStock;

    batches[batchNumber] = batch;
    return batch;
  }

  // Day 1 Replenishments
  await createPurchaseBatch('BATCH-2026-08-001', compSteel, 200, 1400.0, 1, 'Initial bulk procurement of steel sheets');
  await createPurchaseBatch('BATCH-2026-08-002', compAluminum, 300, 420.0, 1, 'Initial aluminum rod shipment');
  await createPurchaseBatch('BATCH-2026-08-003', compPlastic, 250, 230.0, 1, 'Initial plastic housing shipment');
  await createPurchaseBatch('BATCH-2026-08-004', compCopper, 600, 110.0, 1, 'Initial copper wire reels');
  await createPurchaseBatch('BATCH-2026-08-005', compSeal, 300, 30.0, 1, 'Initial rubber seals stock');
  await createPurchaseBatch('BATCH-2026-08-006', compBearing, 200, 170.0, 1, 'Initial precision ball bearings shipment');
  await createPurchaseBatch('BATCH-2026-08-007', compMotor, 50, 3300.0, 1, 'Initial motor units shipment');
  await createPurchaseBatch('BATCH-2026-08-008', compScrews, 300, 45.0, 1, 'Initial machine screws stock');
  await createPurchaseBatch('BATCH-2026-08-009', compBox, 400, 80.0, 1, 'Initial packaging boxes shipment');
  await createPurchaseBatch('BATCH-2026-08-010', compGlue, 100, 200.0, 1, 'Initial industrial adhesive glue bottles');

  // Day 15 Mid-month Replenishment
  await createPurchaseBatch('BATCH-2026-08-011', compSteel, 100, 1450.0, 15, 'Mid-month steel sheet replenishment');
  await createPurchaseBatch('BATCH-2026-08-012', compCopper, 400, 115.0, 15, 'Mid-month copper wire replenishment');
  await createPurchaseBatch('BATCH-2026-08-013', compScrews, 200, 48.0, 15, 'Mid-month screws replenishment');

  // Day 27 Final Replenishment
  await createPurchaseBatch('BATCH-2026-08-014', compMotor, 30, 3400.0, 27, 'End-of-month motor units replenishment');
  await createPurchaseBatch('BATCH-2026-08-015', compPlastic, 150, 240.0, 27, 'End-of-month plastic housing shipment');

  console.log('✓ Initial inventory batches & purchase stock movements created');

  // =========================================================================
  // 10. STOCK ADJUSTMENTS & WRITE-OFFS (DAYS 12 & 18)
  // =========================================================================
  console.log('📦 Recording Stock Adjustments & Write-offs...');

  // Day 12 Stock Adjustment (Found +5 Packaging Boxes during audit)
  const boxStockBefore = Number(compBox.currentStock);
  const boxStockAfter = boxStockBefore + 5;
  await prisma.stockMovement.create({
    data: {
      productId: compBox.id,
      batchId: batches['BATCH-2026-08-009'].id,
      type: StockMovementType.ADJUSTMENT,
      quantity: 5,
      previousQuantity: boxStockBefore,
      newQuantity: boxStockAfter,
      unitCost: 80.0,
      totalCost: 400.0,
      performedById: admin.id,
      notes: 'Mid-month physical count audit correction (+5 boxes found)',
      reason: 'Audit Correction',
      createdAt: simDate(12, 11, 0),
    },
  });
  await prisma.product.update({ where: { id: compBox.id }, data: { currentStock: boxStockAfter } });
  await prisma.inventoryBatch.update({ where: { id: batches['BATCH-2026-08-009'].id }, data: { remainingQuantity: { increment: 5 } } });
  compBox.currentStock = boxStockAfter;

  // Day 18 Write-Off (Damaged 2 bottles of glue during handling)
  const glueStockBefore = Number(compGlue.currentStock);
  const glueStockAfter = glueStockBefore - 2;
  await prisma.stockMovement.create({
    data: {
      productId: compGlue.id,
      batchId: batches['BATCH-2026-08-010'].id,
      type: StockMovementType.WRITE_OFF,
      quantity: 2,
      previousQuantity: glueStockBefore,
      newQuantity: glueStockAfter,
      unitCost: 200.0,
      totalCost: 400.0,
      performedById: admin.id,
      notes: 'Accidental container rupture during warehouse transfer',
      reason: 'Physical Damage',
      createdAt: simDate(18, 14, 30),
    },
  });
  await prisma.product.update({ where: { id: compGlue.id }, data: { currentStock: glueStockAfter } });
  await prisma.inventoryBatch.update({ where: { id: batches['BATCH-2026-08-010'].id }, data: { remainingQuantity: { decrement: 2 } } });
  compGlue.currentStock = glueStockAfter;

  console.log('✓ Stock adjustment & write-off recorded');

  // =========================================================================
  // 11. 30-DAY PRODUCTION SIMULATION & TASK WORKFLOWS
  // =========================================================================
  console.log('📦 Executing 30-Day Production Simulation Tasks...');

  // ─────────────────────────────────────────────────────────────────────────
  // TASK 1: Complete Production Cycle (Day 2 -> Day 6) — COMPLETED
  // Production: 10 units of Electric Control Panel (PROD-001)
  // Assigned: Rahim Uddin (employees[0])
  // BOM per unit: Steel x 2, Copper x 3, Screws x 8, Plastic x 1, Glue x 0.2
  // Total Required: Steel 20, Copper 30, Screws 80, Plastic 10, Glue 2
  // ─────────────────────────────────────────────────────────────────────────
  const task1 = await prisma.task.create({
    data: {
      title: 'Assemble 10 Units of Electric Control Panels',
      description: 'Full electrical assembly, wiring harness routing, and high-voltage testing',
      status: TaskStatus.COMPLETED,
      productId: prodControlPanel.id,
      productionQuantity: 10,
      completedQuantity: 10,
      remainingQuantity: 0,
      deadline: simDate(7, 17, 0),
      acceptedAt: simDate(3, 9, 15),
      startedAt: simDate(4, 8, 30),
      completedAt: simDate(6, 16, 45),
      createdById: admin.id,
      completedById: employees[0].id,
      createdAt: simDate(2, 10, 0),
      assignments: { create: { employeeId: employees[0].id, assignedAt: simDate(2, 10, 0) } },
      requiredProducts: {
        create: [
          { productId: compSteel.id, quantity: 20, unitPrice: 1500.0, unit: 'Sheet' },
          { productId: compCopper.id, quantity: 30, unitPrice: 120.0, unit: 'Meter' },
          { productId: compScrews.id, quantity: 80, unitPrice: 50.0, unit: 'Pack' },
          { productId: compPlastic.id, quantity: 10, unitPrice: 250.0, unit: 'Piece' },
          { productId: compGlue.id, quantity: 2, unitPrice: 220.0, unit: 'Bottle' },
        ],
      },
      batchAllocations: {
        create: [
          { batchId: batches['BATCH-2026-08-001'].id, allocatedQuantity: 20 },
          { batchId: batches['BATCH-2026-08-004'].id, allocatedQuantity: 30 },
          { batchId: batches['BATCH-2026-08-008'].id, allocatedQuantity: 80 },
          { batchId: batches['BATCH-2026-08-003'].id, allocatedQuantity: 10 },
          { batchId: batches['BATCH-2026-08-010'].id, allocatedQuantity: 2 },
        ],
      },
    },
  });

  // Execute Task 1 material consumption & output batch creation
  const task1Consumptions = [
    { p: compSteel, b: batches['BATCH-2026-08-001'], qty: 20, cost: 1400 },
    { p: compCopper, b: batches['BATCH-2026-08-004'], qty: 30, cost: 110 },
    { p: compScrews, b: batches['BATCH-2026-08-008'], qty: 80, cost: 45 },
    { p: compPlastic, b: batches['BATCH-2026-08-003'], qty: 10, cost: 230 },
    { p: compGlue, b: batches['BATCH-2026-08-010'], qty: 2, cost: 200 },
  ];

  for (const item of task1Consumptions) {
    const prev = Number(item.p.currentStock);
    const next = prev - item.qty;
    await prisma.stockMovement.create({
      data: {
        productId: item.p.id,
        batchId: item.b.id,
        type: StockMovementType.CONSUMPTION,
        quantity: item.qty,
        previousQuantity: prev,
        newQuantity: next,
        unitCost: item.cost,
        totalCost: item.qty * item.cost,
        relatedTaskId: task1.id,
        performedById: employees[0].id,
        notes: `Consumed for Task 1: ${task1.title}`,
        createdAt: simDate(6, 16, 45),
      },
    });
    await prisma.product.update({ where: { id: item.p.id }, data: { currentStock: next } });
    await prisma.inventoryBatch.update({ where: { id: item.b.id }, data: { remainingQuantity: { decrement: item.qty } } });
    item.p.currentStock = next;
  }

  // Create Finished Output Batch for Task 1
  const task1OutputBatch = await prisma.inventoryBatch.create({
    data: {
      batchNumber: 'BATCH-2026-08-016',
      productId: prodControlPanel.id,
      initialQuantity: 10,
      remainingQuantity: 10,
      reservedQuantity: 0,
      createdById: admin.id,
      sourceTaskId: task1.id,
      createdAt: simDate(6, 16, 45),
    },
  });

  await prisma.stockMovement.create({
    data: {
      productId: prodControlPanel.id,
      batchId: task1OutputBatch.id,
      type: StockMovementType.ASSEMBLY,
      quantity: 10,
      previousQuantity: 0,
      newQuantity: 10,
      unitCost: 6590.0, // Suggested BOM unit cost sum
      totalCost: 65900.0,
      relatedTaskId: task1.id,
      performedById: employees[0].id,
      notes: 'Completed production output batch',
      createdAt: simDate(6, 16, 45),
    },
  });
  await prisma.product.update({ where: { id: prodControlPanel.id }, data: { currentStock: 10 } });
  prodControlPanel.currentStock = 10;

  // ─────────────────────────────────────────────────────────────────────────
  // TASK 2: Partial Production Cycle (Day 7 -> Day 11) — PARTIALLY_COMPLETED
  // Production: 20 units of Compact Motor Assembly (PROD-002) — Completed 12 units
  // Assigned: Abdul Karim (employees[1])
  // BOM per unit: Motor x 1, Aluminum x 2, Bearing x 2, Seal x 2, Screws x 6
  // Required total (20 units): Motor 20, Aluminum 40, Bearing 40, Seal 40, Screws 120
  // Consumed for 12 units: Motor 12, Aluminum 24, Bearing 24, Seal 24, Screws 72
  // ─────────────────────────────────────────────────────────────────────────
  const task2 = await prisma.task.create({
    data: {
      title: 'Assemble 20 Units of Compact Motor Assemblies',
      description: 'Precision shaft alignment, bearing seating, and seal pressure fitting',
      status: TaskStatus.PARTIALLY_COMPLETED,
      productId: prodMotorAssembly.id,
      productionQuantity: 20,
      completedQuantity: 12,
      remainingQuantity: 8,
      deadline: simDate(12, 17, 0),
      acceptedAt: simDate(8, 8, 45),
      startedAt: simDate(8, 10, 0),
      createdById: admin.id,
      createdAt: simDate(7, 9, 0),
      assignments: { create: { employeeId: employees[1].id, assignedAt: simDate(7, 9, 0) } },
      requiredProducts: {
        create: [
          { productId: compMotor.id, quantity: 20, unitPrice: 3500.0, unit: 'Piece' },
          { productId: compAluminum.id, quantity: 40, unitPrice: 450.0, unit: 'Meter' },
          { productId: compBearing.id, quantity: 40, unitPrice: 180.0, unit: 'Piece' },
          { productId: compSeal.id, quantity: 40, unitPrice: 35.0, unit: 'Piece' },
          { productId: compScrews.id, quantity: 120, unitPrice: 50.0, unit: 'Pack' },
        ],
      },
      batchAllocations: {
        create: [
          { batchId: batches['BATCH-2026-08-007'].id, allocatedQuantity: 20 },
          { batchId: batches['BATCH-2026-08-002'].id, allocatedQuantity: 40 },
          { batchId: batches['BATCH-2026-08-006'].id, allocatedQuantity: 40 },
          { batchId: batches['BATCH-2026-08-005'].id, allocatedQuantity: 40 },
          { batchId: batches['BATCH-2026-08-008'].id, allocatedQuantity: 120 },
        ],
      },
    },
  });

  const task2Consumptions = [
    { p: compMotor, b: batches['BATCH-2026-08-007'], qty: 12, cost: 3300 },
    { p: compAluminum, b: batches['BATCH-2026-08-002'], qty: 24, cost: 420 },
    { p: compBearing, b: batches['BATCH-2026-08-006'], qty: 24, cost: 170 },
    { p: compSeal, b: batches['BATCH-2026-08-005'], qty: 24, cost: 30 },
    { p: compScrews, b: batches['BATCH-2026-08-008'], qty: 72, cost: 45 },
  ];

  for (const item of task2Consumptions) {
    const prev = Number(item.p.currentStock);
    const next = prev - item.qty;
    await prisma.stockMovement.create({
      data: {
        productId: item.p.id,
        batchId: item.b.id,
        type: StockMovementType.CONSUMPTION,
        quantity: item.qty,
        previousQuantity: prev,
        newQuantity: next,
        unitCost: item.cost,
        totalCost: item.qty * item.cost,
        relatedTaskId: task2.id,
        performedById: employees[1].id,
        notes: `Partial consumption (12/20 units) for Task 2: ${task2.title}`,
        createdAt: simDate(11, 15, 30),
      },
    });
    await prisma.product.update({ where: { id: item.p.id }, data: { currentStock: next } });
    await prisma.inventoryBatch.update({ where: { id: item.b.id }, data: { remainingQuantity: { decrement: item.qty } } });
    item.p.currentStock = next;
  }

  // Create Finished Output Batch for Task 2 (12 units)
  const task2OutputBatch = await prisma.inventoryBatch.create({
    data: {
      batchNumber: 'BATCH-2026-08-017',
      productId: prodMotorAssembly.id,
      initialQuantity: 12,
      remainingQuantity: 12,
      reservedQuantity: 0,
      createdById: admin.id,
      sourceTaskId: task2.id,
      createdAt: simDate(11, 15, 30),
    },
  });

  await prisma.stockMovement.create({
    data: {
      productId: prodMotorAssembly.id,
      batchId: task2OutputBatch.id,
      type: StockMovementType.ASSEMBLY,
      quantity: 12,
      previousQuantity: 0,
      newQuantity: 12,
      unitCost: 4890.0,
      totalCost: 58680.0,
      relatedTaskId: task2.id,
      performedById: employees[1].id,
      notes: 'Partial production output batch (12 units)',
      createdAt: simDate(11, 15, 30),
    },
  });
  await prisma.product.update({ where: { id: prodMotorAssembly.id }, data: { currentStock: 12 } });
  prodMotorAssembly.currentStock = 12;

  // ─────────────────────────────────────────────────────────────────────────
  // TASK 3: In-Progress Task (Day 12 -> Day 16) — IN_PROGRESS
  // Production: 15 units of Industrial Sensor Unit (PROD-003)
  // Assigned: Tanvir Ahmed (employees[2])
  // BOM per unit: Plastic x 1, Copper x 2, Screws x 4, Box x 1, Glue x 0.1
  // Required: Plastic 15, Copper 30, Screws 60, Box 15, Glue 1.5
  // ─────────────────────────────────────────────────────────────────────────
  await prisma.task.create({
    data: {
      title: 'Produce 15 Industrial Sensor Units',
      description: 'Telemetry sensor calibration, PCB housing sealing, and waterproof box enclosure',
      status: TaskStatus.IN_PROGRESS,
      productId: prodSensorUnit.id,
      productionQuantity: 15,
      completedQuantity: 0,
      remainingQuantity: 15,
      deadline: simDate(18, 17, 0),
      acceptedAt: simDate(13, 9, 0),
      startedAt: simDate(14, 8, 30),
      createdById: admin.id,
      createdAt: simDate(12, 14, 0),
      assignments: { create: { employeeId: employees[2].id, assignedAt: simDate(12, 14, 0) } },
      requiredProducts: {
        create: [
          { productId: compPlastic.id, quantity: 15, unitPrice: 250.0, unit: 'Piece' },
          { productId: compCopper.id, quantity: 30, unitPrice: 120.0, unit: 'Meter' },
          { productId: compScrews.id, quantity: 60, unitPrice: 50.0, unit: 'Pack' },
          { productId: compBox.id, quantity: 15, unitPrice: 85.0, unit: 'Piece' },
          { productId: compGlue.id, quantity: 1.5, unitPrice: 220.0, unit: 'Bottle' },
        ],
      },
      batchAllocations: {
        create: [
          { batchId: batches['BATCH-2026-08-003'].id, allocatedQuantity: 15 },
          { batchId: batches['BATCH-2026-08-004'].id, allocatedQuantity: 30 },
          { batchId: batches['BATCH-2026-08-008'].id, allocatedQuantity: 60 },
          { batchId: batches['BATCH-2026-08-009'].id, allocatedQuantity: 15 },
          { batchId: batches['BATCH-2026-08-010'].id, allocatedQuantity: 1.5 },
        ],
      },
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TASK 4: Accepted Task with Damage & Refill Workflow (Day 17 -> Day 21) — ACCEPTED
  // Production: 25 units of Power Distribution Box (PROD-004)
  // Assigned: Saiful Islam (employees[3])
  // ─────────────────────────────────────────────────────────────────────────
  const task4 = await prisma.task.create({
    data: {
      title: 'Assemble 25 Power Distribution Boxes',
      description: 'Sub-station branching busbars, internal insulator pads, and packaging',
      status: TaskStatus.ACCEPTED,
      productId: prodDistBox.id,
      productionQuantity: 25,
      completedQuantity: 0,
      remainingQuantity: 25,
      deadline: simDate(23, 17, 0),
      acceptedAt: simDate(17, 11, 0),
      createdById: admin.id,
      createdAt: simDate(17, 8, 30),
      assignments: { create: { employeeId: employees[3].id, assignedAt: simDate(17, 8, 30) } },
      requiredProducts: {
        create: [
          { productId: compSteel.id, quantity: 25, unitPrice: 1500.0, unit: 'Sheet' },
          { productId: compCopper.id, quantity: 125, unitPrice: 120.0, unit: 'Meter' },
          { productId: compPlastic.id, quantity: 50, unitPrice: 250.0, unit: 'Piece' },
          { productId: compScrews.id, quantity: 250, unitPrice: 50.0, unit: 'Pack' },
          { productId: compBox.id, quantity: 25, unitPrice: 85.0, unit: 'Piece' },
        ],
      },
      batchAllocations: {
        create: [
          { batchId: batches['BATCH-2026-08-001'].id, allocatedQuantity: 25 },
          { batchId: batches['BATCH-2026-08-004'].id, allocatedQuantity: 125 },
          { batchId: batches['BATCH-2026-08-003'].id, allocatedQuantity: 50 },
          { batchId: batches['BATCH-2026-08-008'].id, allocatedQuantity: 250 },
          { batchId: batches['BATCH-2026-08-009'].id, allocatedQuantity: 25 },
        ],
      },
    },
  });

  // Material Damage & Approved Refill for Task 4 (Day 18)
  const screwStockBeforeDamage = Number(compScrews.currentStock);
  const screwStockAfterDamage = screwStockBeforeDamage - 5;

  await prisma.stockMovement.create({
    data: {
      productId: compScrews.id,
      batchId: batches['BATCH-2026-08-008'].id,
      type: StockMovementType.DAMAGE,
      quantity: 5,
      previousQuantity: screwStockBeforeDamage,
      newQuantity: screwStockAfterDamage,
      unitCost: 45.0,
      totalCost: 225.0,
      relatedTaskId: task4.id,
      performedById: employees[3].id,
      notes: '5 packs of screws stripped/damaged during pneumatic driver calibration',
      reason: 'Tool Miscalibration Damage',
      createdAt: simDate(18, 10, 15),
    },
  });
  await prisma.product.update({ where: { id: compScrews.id }, data: { currentStock: screwStockAfterDamage } });
  await prisma.inventoryBatch.update({ where: { id: batches['BATCH-2026-08-008'].id }, data: { remainingQuantity: { decrement: 5 } } });
  compScrews.currentStock = screwStockAfterDamage;

  // Refill Product Request created & approved for Task 4
  const refillReqApproved = await prisma.productRequest.create({
    data: {
      productId: compScrews.id,
      quantity: 5,
      type: ProductRequestType.TASK_RELATED,
      status: ProductRequestStatus.APPROVED,
      taskId: task4.id,
      requestedById: employees[3].id,
      approvedById: admin.id,
      reason: 'Refill 5 packs of screws lost to pneumatic driver damage',
      createdAt: simDate(18, 11, 0),
    },
  });

  await prisma.stockMovement.create({
    data: {
      productId: compScrews.id,
      batchId: batches['BATCH-2026-08-013'].id,
      type: StockMovementType.REFILL,
      quantity: 5,
      previousQuantity: screwStockAfterDamage,
      newQuantity: screwStockAfterDamage,
      unitCost: 48.0,
      totalCost: 240.0,
      relatedTaskId: task4.id,
      relatedRequestId: refillReqApproved.id,
      performedById: admin.id,
      notes: 'Approved refill batch issue for Task 4',
      createdAt: simDate(18, 14, 0),
    },
  });

  // Rejected Refill Request for Task 4 (Plastic Housing)
  await prisma.productRequest.create({
    data: {
      productId: compPlastic.id,
      quantity: 10,
      type: ProductRequestType.TASK_RELATED,
      status: ProductRequestStatus.REJECTED,
      taskId: task4.id,
      requestedById: employees[3].id,
      approvedById: admin.id,
      reason: 'Requesting extra plastic housings for backup spares',
      rejectionReason: 'Backup spares exceed approved BOM buffer allowance',
      createdAt: simDate(19, 15, 0),
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TASK 5: Cancelled Task (Day 22 -> Day 24) — CANCELLED
  // Production: 10 units of Automated Control Module (PROD-005)
  // Assigned: Saiful Islam (employees[3])
  // ─────────────────────────────────────────────────────────────────────────
  await prisma.task.create({
    data: {
      title: 'Assemble 10 Automated Control Modules',
      description: 'High-speed motor drive assembly with dual bearing mounts',
      status: TaskStatus.CANCELLED,
      productId: prodControlModule.id,
      productionQuantity: 10,
      completedQuantity: 0,
      remainingQuantity: 10,
      deadline: simDate(26, 17, 0),
      acceptedAt: simDate(23, 9, 30),
      createdById: admin.id,
      createdAt: simDate(22, 10, 0),
      assignments: { create: { employeeId: employees[3].id, assignedAt: simDate(22, 10, 0) } },
      requiredProducts: {
        create: [
          { productId: compMotor.id, quantity: 10, unitPrice: 3500.0, unit: 'Piece' },
          { productId: compSteel.id, quantity: 10, unitPrice: 1500.0, unit: 'Sheet' },
          { productId: compAluminum.id, quantity: 10, unitPrice: 450.0, unit: 'Meter' },
          { productId: compBearing.id, quantity: 20, unitPrice: 180.0, unit: 'Piece' },
          { productId: compCopper.id, quantity: 40, unitPrice: 120.0, unit: 'Meter' },
          { productId: compScrews.id, quantity: 80, unitPrice: 50.0, unit: 'Pack' },
        ],
      },
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TASK 6: Pending Task (Day 25 -> Day 29) — PENDING
  // Production: 12 units of Electric Control Panel (PROD-001)
  // Assigned: Nadia Sultana (employees[4])
  // ─────────────────────────────────────────────────────────────────────────
  await prisma.task.create({
    data: {
      title: 'Assemble 12 Units of Electric Control Panels',
      description: 'End-of-month client order fulfillment build',
      status: TaskStatus.PENDING,
      productId: prodControlPanel.id,
      productionQuantity: 12,
      completedQuantity: 0,
      remainingQuantity: 12,
      deadline: simDate(30, 17, 0),
      createdById: admin.id,
      createdAt: simDate(25, 11, 0),
      assignments: { create: { employeeId: employees[4].id, assignedAt: simDate(25, 11, 0) } },
      requiredProducts: {
        create: [
          { productId: compSteel.id, quantity: 24, unitPrice: 1500.0, unit: 'Sheet' },
          { productId: compCopper.id, quantity: 36, unitPrice: 120.0, unit: 'Meter' },
          { productId: compScrews.id, quantity: 96, unitPrice: 50.0, unit: 'Pack' },
          { productId: compPlastic.id, quantity: 12, unitPrice: 250.0, unit: 'Piece' },
        ],
      },
    },
  });

  console.log('✓ 6 Production tasks created spanning PENDING, ACCEPTED, IN_PROGRESS, PARTIALLY_COMPLETED, COMPLETED, CANCELLED');

  // =========================================================================
  // 12. GENERAL PRODUCT REQUESTS (APPROVED, REJECTED, ISSUED)
  // =========================================================================
  console.log('📦 Creating Additional Product Requests...');

  // General Issued Request 1 (5 Steel sheets issued for maintenance)
  const reqIssued1 = await prisma.productRequest.create({
    data: {
      productId: compSteel.id,
      quantity: 5,
      type: ProductRequestType.GENERAL,
      status: ProductRequestStatus.APPROVED,
      requestedById: employees[0].id,
      approvedById: admin.id,
      reason: 'Steel sheets required for workstation jig fabrication',
      createdAt: simDate(20, 10, 0),
    },
  });

  const steelStockBeforeIssued = Number(compSteel.currentStock);
  const steelStockAfterIssued = steelStockBeforeIssued - 5;
  await prisma.stockMovement.create({
    data: {
      productId: compSteel.id,
      batchId: batches['BATCH-2026-08-001'].id,
      type: StockMovementType.CONSUMPTION,
      quantity: 5,
      previousQuantity: steelStockBeforeIssued,
      newQuantity: steelStockAfterIssued,
      unitCost: 1400.0,
      totalCost: 7000.0,
      relatedRequestId: reqIssued1.id,
      performedById: admin.id,
      notes: 'Issued steel sheets for general workstation jig fabrication',
      createdAt: simDate(20, 14, 0),
    },
  });
  await prisma.product.update({ where: { id: compSteel.id }, data: { currentStock: steelStockAfterIssued } });
  await prisma.inventoryBatch.update({ where: { id: batches['BATCH-2026-08-001'].id }, data: { remainingQuantity: { decrement: 5 } } });
  compSteel.currentStock = steelStockAfterIssued;

  // General Issued Request 2 (10 Copper Wire meters issued for shopfloor wiring)
  const reqIssued2 = await prisma.productRequest.create({
    data: {
      productId: compCopper.id,
      quantity: 10,
      type: ProductRequestType.GENERAL,
      status: ProductRequestStatus.APPROVED,
      requestedById: employees[1].id,
      approvedById: admin.id,
      reason: 'Shopfloor testing bench power line extension',
      createdAt: simDate(21, 11, 0),
    },
  });

  const copperStockBeforeIssued = Number(compCopper.currentStock);
  const copperStockAfterIssued = copperStockBeforeIssued - 10;
  await prisma.stockMovement.create({
    data: {
      productId: compCopper.id,
      batchId: batches['BATCH-2026-08-004'].id,
      type: StockMovementType.CONSUMPTION,
      quantity: 10,
      previousQuantity: copperStockBeforeIssued,
      newQuantity: copperStockAfterIssued,
      unitCost: 110.0,
      totalCost: 1100.0,
      relatedRequestId: reqIssued2.id,
      performedById: admin.id,
      notes: 'Issued copper wire for testing bench extension',
      createdAt: simDate(21, 15, 0),
    },
  });
  await prisma.product.update({ where: { id: compCopper.id }, data: { currentStock: copperStockAfterIssued } });
  await prisma.inventoryBatch.update({ where: { id: batches['BATCH-2026-08-004'].id }, data: { remainingQuantity: { decrement: 10 } } });
  compCopper.currentStock = copperStockAfterIssued;

  // General Approved Request (Pending physical handover)
  await prisma.productRequest.create({
    data: {
      productId: compBox.id,
      quantity: 20,
      type: ProductRequestType.GENERAL,
      status: ProductRequestStatus.APPROVED,
      requestedById: employees[2].id,
      approvedById: admin.id,
      reason: 'Packaging boxes for outgoing QA sample shipments',
      createdAt: simDate(24, 13, 0),
    },
  });

  // General Pending Request
  await prisma.productRequest.create({
    data: {
      productId: compAluminum.id,
      quantity: 15,
      type: ProductRequestType.GENERAL,
      status: ProductRequestStatus.PENDING,
      requestedById: employees[3].id,
      reason: 'Aluminum rods requested for rack bracing',
      createdAt: simDate(28, 9, 30),
    },
  });

  // General Rejected Request
  await prisma.productRequest.create({
    data: {
      productId: compMotor.id,
      quantity: 2,
      type: ProductRequestType.GENERAL,
      status: ProductRequestStatus.REJECTED,
      requestedById: employees[4].id,
      approvedById: admin.id,
      reason: 'Unscheduled spare motor unit request',
      rejectionReason: 'Motors are strictly restricted to scheduled production tasks',
      createdAt: simDate(26, 16, 0),
    },
  });

  console.log('✓ 7 Product requests created (3 APPROVED, 2 REJECTED, 2 ISSUED)');

  // =========================================================================
  // 13. 30 DAYS ATTENDANCE & OVERTIME SIMULATION
  // =========================================================================
  console.log('📦 Generating 30 Days of Employee Attendance & Overtime Records...');

  let attendanceCount = 0;
  let overtimeCount = 0;

  for (let dayIdx = 1; dayIdx <= 30; dayIdx++) {
    const dayDate = simDate(dayIdx, 0, 0);
    const dayOfWeek = dayDate.getUTCDay(); // 0 = Sunday, 6 = Saturday

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    for (let empIdx = 0; empIdx < employees.length; empIdx++) {
      const emp = employees[empIdx];

      // Deterministic variations in check-in and check-out
      const inMinute = 45 + ((dayIdx + empIdx * 7) % 25); // 08:45 to 09:10
      const outMinute = 0 + ((dayIdx * 3 + empIdx * 11) % 45); // 17:00 to 17:45 or 18:30 for overtime

      const isOvertimeDay = (dayIdx + empIdx) % 3 === 0;
      const outHour = isOvertimeDay ? 18 + (empIdx % 2) : 17; // 18:xx or 19:xx

      const checkInTime = simDate(dayIdx, 8, inMinute);
      const checkOutTime = simDate(dayIdx, outHour, outMinute);

      const diffMs = checkOutTime.getTime() - checkInTime.getTime();
      const workedHours = Number((diffMs / (1000 * 60 * 60)).toFixed(2));
      const requiredHours = 8.0;
      const rawOt = Math.max(0, Number((workedHours - requiredHours).toFixed(2)));

      let otStatus = OvertimeStatus.PENDING;
      let adminOtHours: number | null = null;
      let otDecidedById: string | null = null;
      let otDecidedAt: Date | null = null;

      if (rawOt > 0) {
        overtimeCount++;
        // Approve 70% of overtime, reject 15%, leave 15% pending
        const otMod = (dayIdx + empIdx) % 10;
        if (otMod < 7) {
          otStatus = OvertimeStatus.APPROVED;
          adminOtHours = rawOt;
          otDecidedById = admin.id;
          otDecidedAt = simDate(dayIdx + 1, 9, 0);
        } else if (otMod < 9) {
          otStatus = OvertimeStatus.REJECTED;
          adminOtHours = 0;
          otDecidedById = admin.id;
          otDecidedAt = simDate(dayIdx + 1, 9, 30);
        }
      }

      // Add 1 attendance override scenario for Rahim on Day 10
      const isOverride = dayIdx === 10 && empIdx === 0;

      await prisma.attendance.create({
        data: {
          employeeId: emp.id,
          date: dayDate,
          checkIn: checkInTime,
          checkOut: checkOutTime,
          workedHours,
          calculatedHours: workedHours,
          requiredHours,
          overtimeHours: rawOt > 0 ? rawOt : null,
          adminOvertimeHours: adminOtHours,
          overtimeStatus: rawOt > 0 ? otStatus : OvertimeStatus.PENDING,
          overtimeReason: rawOt > 0 ? 'Production deadline shift extension' : null,
          overtimeDecidedById: otDecidedById,
          overtimeDecidedAt: otDecidedAt,
          lateMinutes: inMinute > 60 ? inMinute - 60 : 0,
          earlyMinutes: 0,
          source: AttendanceSource.WEB,
          isOverride,
          overriddenById: isOverride ? admin.id : null,
          overrideReason: isOverride ? 'Biometric reader network glitch timestamp correction' : null,
          overrideOldValues: isOverride ? { oldCheckIn: simDate(10, 9, 30).toISOString(), oldWorkedHours: 7.5 } : undefined,
          notes: isOverride ? 'Corrected by Admin' : 'Standard daily punch record',
          createdAt: checkInTime,
        },
      });
      attendanceCount++;
    }
  }

  console.log(`✓ Created ${attendanceCount} Attendance records across 30 days (${overtimeCount} Overtime events)`);

  // =========================================================================
  // 14. PAYROLL & SALARY PAYMENTS (PREVIOUS MONTH & CURRENT MONTH)
  // =========================================================================
  console.log('📦 Calculating Payroll & Recording Salary Payments...');

  // July 2026 (Previous Month Snapshot & Salary Payments)
  const prevYear = 2026;
  const prevMonth = 7;

  // Create MonthlyPayrollSnapshots for July
  for (const emp of employees) {
    await prisma.monthlyPayrollSnapshot.create({
      data: {
        employeeId: emp.id,
        year: prevYear,
        month: prevMonth,
        hourlyRate: emp.employeeProfile.hourlyRate,
        overtimeMultiplier: 1.5,
        requiredDailyHours: 8.0,
        isLocked: true,
        lockedAt: simDate(1, 10, 0),
      },
    });
  }

  // Simulated July Earnings & Salary Payment Scenarios:
  // Employee 0 (Rahim):   Earned 35,000 BDT — Fully Paid (35,000 BDT) -> PAID
  // Employee 1 (Karim):   Earned 42,000 BDT — Partially Paid (25,000 BDT in 2 payments: 15,000 + 10,000) -> PARTIALLY_PAID
  // Employee 2 (Tanvir):  Earned 52,000 BDT — Fully Paid (52,000 BDT) -> PAID
  // Employee 3 (Saiful):  Earned 60,000 BDT — Partially Paid (30,000 BDT) -> PARTIALLY_PAID
  // Employee 4 (Nadia):   Earned 72,000 BDT — Unpaid (0 BDT) -> UNPAID

  const paymentSchedule = [
    { emp: employees[0], amount: 35000.0, note: 'Full monthly salary payment for July' },
    { emp: employees[1], amount: 15000.0, note: 'First installment salary payment for July' },
    { emp: employees[1], amount: 10000.0, note: 'Second installment salary payment for July' },
    { emp: employees[2], amount: 52000.0, note: 'Full monthly salary payment for July' },
    { emp: employees[3], amount: 30000.0, note: 'Mid-month advance salary payment for July' },
  ];

  let salaryPaymentCount = 0;
  for (const p of paymentSchedule) {
    await prisma.salaryPayment.create({
      data: {
        employeeId: p.emp.id,
        year: prevYear,
        month: prevMonth,
        amount: p.amount,
        note: p.note,
        paidById: admin.id,
        createdAt: simDate(2, 11, 30),
      },
    });
    salaryPaymentCount++;
  }

  console.log(`✓ Created ${salaryPaymentCount} Salary Payment transactions for July billing period`);

  // =========================================================================
  // 15. NOTIFICATIONS
  // =========================================================================
  console.log('📦 Generating System Notifications...');

  const notificationItems = [
    { user: admin, title: 'Low Stock Alert', message: 'Motor Unit stock is below threshold (15 units remaining)', url: '/inventory', eventKey: 'LOW_STOCK_COMP-007' },
    { user: admin, title: 'Low Stock Alert', message: 'Steel Sheet stock is below threshold (20 units remaining)', url: '/inventory', eventKey: 'LOW_STOCK_COMP-001' },
    { user: employees[0], title: 'New Task Assigned', message: 'You have been assigned to Task: Assemble 10 Units of Electric Control Panels', url: `/tasks/${task1.id}`, eventKey: `TASK_ASSIGN_${task1.id}` },
    { user: admin, title: 'Task Accepted', message: 'Rahim Uddin accepted Task: Assemble 10 Units of Electric Control Panels', url: `/tasks/${task1.id}`, eventKey: `TASK_ACCEPT_${task1.id}` },
    { user: admin, title: 'Task Started', message: 'Rahim Uddin started Task: Assemble 10 Units of Electric Control Panels', url: `/tasks/${task1.id}`, eventKey: `TASK_START_${task1.id}` },
    { user: admin, title: 'Task Completed', message: 'Rahim Uddin completed Task: Assemble 10 Units of Electric Control Panels', url: `/tasks/${task1.id}`, eventKey: `TASK_COMPLETE_${task1.id}` },
    { user: employees[1], title: 'New Task Assigned', message: 'You have been assigned to Task: Assemble 20 Units of Compact Motor Assemblies', url: `/tasks/${task2.id}`, eventKey: `TASK_ASSIGN_${task2.id}` },
    { user: admin, title: 'Partial Production Reported', message: 'Abdul Karim reported 12 units completed for Task 2', url: `/tasks/${task2.id}`, eventKey: `TASK_PARTIAL_${task2.id}` },
    { user: admin, title: 'Material Damage Reported', message: 'Saiful Islam reported 5 packs of screws damaged on Task 4', url: `/tasks/${task4.id}`, eventKey: `DAMAGE_${task4.id}` },
    { user: admin, title: 'Refill Request Received', message: 'Saiful Islam requested 5 packs of screws for Task 4', url: '/requests', eventKey: `REFILL_REQ_${refillReqApproved.id}` },
    { user: employees[3], title: 'Refill Request Approved', message: 'Admin approved your refill request for 5 packs of screws', url: '/requests', eventKey: `REFILL_APP_${refillReqApproved.id}` },
    { user: employees[0], title: 'Salary Payment Recorded', message: 'Salary payment of 35,000 BDT recorded for July 2026', url: '/payroll/me', eventKey: 'PAYMENT_JULY_EMP0' },
    { user: employees[1], title: 'Salary Payment Recorded', message: 'Salary payment of 15,000 BDT recorded for July 2026', url: '/payroll/me', eventKey: 'PAYMENT_JULY_EMP1_1' },
    { user: employees[1], title: 'Salary Payment Recorded', message: 'Salary payment of 10,000 BDT recorded for July 2026', url: '/payroll/me', eventKey: 'PAYMENT_JULY_EMP1_2' },
    { user: employees[2], title: 'Salary Payment Recorded', message: 'Salary payment of 52,000 BDT recorded for July 2026', url: '/payroll/me', eventKey: 'PAYMENT_JULY_EMP2' },
    { user: employees[3], title: 'Salary Payment Recorded', message: 'Salary payment of 30,000 BDT recorded for July 2026', url: '/payroll/me', eventKey: 'PAYMENT_JULY_EMP3' },
  ];

  let notifCount = 0;
  for (const n of notificationItems) {
    await prisma.notification.create({
      data: {
        userId: n.user.id,
        title: n.title,
        message: n.message,
        targetUrl: n.url,
        isRead: false,
        eventKey: n.eventKey,
        createdAt: simDate(15, 10, 0),
      },
    });
    notifCount++;
  }
  console.log(`✓ Created ${notifCount} System Notification records`);

  // =========================================================================
  // 15. MANDATORY POST-SEED VALIDATION
  // =========================================================================
  console.log('\n========================================');
  console.log('Running Mandatory Post-Seed Validation Checks');
  console.log('========================================');

  const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
  const empCount = await prisma.user.count({ where: { role: Role.EMPLOYEE } });
  const catCount = await prisma.category.count();
  const vdrCount = await prisma.vendor.count();
  const compCount = await prisma.product.count({ where: { itemType: ItemType.COMPONENT } });
  const prodCount = await prisma.product.count({ where: { itemType: ItemType.PRODUCT } });
  const bomCount = await prisma.productBOM.count();
  const batchCount = await prisma.inventoryBatch.count();
  const movementCount = await prisma.stockMovement.count();
  const taskCount = await prisma.task.count();
  const reqCount = await prisma.productRequest.count();
  const attCount = await prisma.attendance.count();
  const payCount = await prisma.salaryPayment.count();
  const notiCount = await prisma.notification.count();

  // Validate Counts
  console.log(`  ✓ Users: ${adminCount + empCount} (Admin: ${adminCount}, Employees: ${empCount})`);
  console.log(`  ✓ Categories: ${catCount}`);
  console.log(`  ✓ Vendors: ${vdrCount}`);
  console.log(`  ✓ Inventory Items: ${compCount + prodCount} (Components: ${compCount}, Products: ${prodCount})`);
  console.log(`  ✓ BOM Relationships: ${bomCount}`);
  console.log(`  ✓ Inventory Batches: ${batchCount}`);
  console.log(`  ✓ Stock Movements: ${movementCount}`);
  console.log(`  ✓ Production Tasks: ${taskCount}`);
  console.log(`  ✓ Product Requests: ${reqCount}`);
  console.log(`  ✓ Attendance Records: ${attCount}`);
  console.log(`  ✓ Salary Payments: ${payCount}`);
  console.log(`  ✓ Notifications: ${notiCount}`);

  // Assertions
  if (adminCount !== 1) throw new Error(`Validation Error: Expected 1 Admin, got ${adminCount}`);
  if (empCount !== 5) throw new Error(`Validation Error: Expected 5 Employees, got ${empCount}`);
  if (catCount !== 2) throw new Error(`Validation Error: Expected 2 Categories, got ${catCount}`);
  if (vdrCount !== 3) throw new Error(`Validation Error: Expected 3 Vendors, got ${vdrCount}`);
  if (compCount !== 10) throw new Error(`Validation Error: Expected 10 Components, got ${compCount}`);
  if (prodCount !== 5) throw new Error(`Validation Error: Expected 5 Products, got ${prodCount}`);

  // Validate Employee Rates (150 to 400 BDT)
  const profiles = await prisma.employeeProfile.findMany();
  for (const prof of profiles) {
    const rate = Number(prof.hourlyRate);
    if (rate < 150 || rate > 400) {
      throw new Error(`Validation Error: Employee hourly rate ${rate} is outside allowed range 150-400 BDT`);
    }
  }
  console.log('  ✓ Employee Hourly Rates Range Verified (150–400 BDT)');

  // Validate Stock Non-Negativity
  const negativeStockProducts = await prisma.product.findMany({
    where: { currentStock: { lt: 0 } },
  });
  if (negativeStockProducts.length > 0) {
    throw new Error(`Validation Error: Found ${negativeStockProducts.length} products with negative stock!`);
  }
  console.log('  ✓ Zero Negative Stock Invariant Verified');

  // Validate Authentication Credential Hashing
  const adminDb = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  const passValid = await bcrypt.compare('admin123', adminDb!.password);
  if (!passValid) {
    throw new Error('Validation Error: Admin password hash verification failed!');
  }
  console.log('  ✓ Admin Password Hash Verification Verified (admin@example.com / admin123)');

  console.log('\n========================================');
  console.log('Inventory Management Demo Seed Complete');
  console.log('========================================');
  console.log('\nAdmin:');
  console.log('  Email:    admin@example.com');
  console.log('  Password: admin123');
  console.log('\nEmployees:');
  console.log('  rahim@example.com  (180 BDT/hr)');
  console.log('  karim@example.com  (220 BDT/hr)');
  console.log('  tanvir@example.com (275 BDT/hr)');
  console.log('  saiful@example.com (320 BDT/hr)');
  console.log('  nadia@example.com  (390 BDT/hr)');
  console.log('  Password for all: admin123');
  console.log('\nSimulation: 30 days');
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error('\n💥 Failed during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
