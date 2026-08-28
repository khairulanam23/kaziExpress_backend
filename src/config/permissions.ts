export interface PermissionDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
}

export const PERMISSION_CATEGORIES = {
  INVENTORY: 'Inventory Management',
  CATEGORIES: 'Category Management',
  VENDORS: 'Vendor Management',
  PRODUCTS_BOM: 'Products & Bill of Materials',
  PRODUCTION: 'Production & Task Management',
  ATTENDANCE: 'Attendance & Overtime',
  PAYROLL: 'Payroll & Salary Management',
  NOTIFICATIONS: 'Notifications',
  REPORTS: 'Reports & Analytics',
  DASHBOARD: 'Dashboard',
  EMPLOYEE_MGMT: 'Employee & Access Control',
  SALES: 'Sales & Finished Goods',
} as const;

export const SYSTEM_PERMISSIONS: PermissionDefinition[] = [
  // ── Inventory ──
  { key: 'INVENTORY_VIEW', name: 'View Inventory', description: 'View inventory items, stock levels, and batch data', category: PERMISSION_CATEGORIES.INVENTORY },
  { key: 'INVENTORY_CREATE', name: 'Create Inventory Stock', description: 'Add new stock and create inventory batches', category: PERMISSION_CATEGORIES.INVENTORY },
  { key: 'INVENTORY_UPDATE', name: 'Update Inventory Stock', description: 'Modify inventory details', category: PERMISSION_CATEGORIES.INVENTORY },
  { key: 'INVENTORY_DELETE', name: 'Delete Inventory Data', description: 'Remove inventory records', category: PERMISSION_CATEGORIES.INVENTORY },
  { key: 'INVENTORY_MANAGE_STOCK', name: 'Manage Stock Adjustments', description: 'Perform manual stock adjustments, consumption, and assembly', category: PERMISSION_CATEGORIES.INVENTORY },
  { key: 'INVENTORY_MANAGE_BATCHES', name: 'Manage Inventory Batches', description: 'View and allocate specific inventory batches', category: PERMISSION_CATEGORIES.INVENTORY },
  { key: 'INVENTORY_VIEW_MOVEMENTS', name: 'View Stock Movement History', description: 'View detailed audit trail of all stock movements', category: PERMISSION_CATEGORIES.INVENTORY },

  // ── Categories ──
  { key: 'CATEGORY_VIEW', name: 'View Categories', description: 'View product categories', category: PERMISSION_CATEGORIES.CATEGORIES },
  { key: 'CATEGORY_CREATE', name: 'Create Category', description: 'Create product categories', category: PERMISSION_CATEGORIES.CATEGORIES },
  { key: 'CATEGORY_UPDATE', name: 'Update Category', description: 'Edit product categories', category: PERMISSION_CATEGORIES.CATEGORIES },
  { key: 'CATEGORY_DELETE', name: 'Delete Category', description: 'Remove product categories', category: PERMISSION_CATEGORIES.CATEGORIES },

  // ── Vendors ──
  { key: 'VENDOR_VIEW', name: 'View Vendors', description: 'View vendor supplier details', category: PERMISSION_CATEGORIES.VENDORS },
  { key: 'VENDOR_CREATE', name: 'Create Vendor', description: 'Add new vendor suppliers', category: PERMISSION_CATEGORIES.VENDORS },
  { key: 'VENDOR_UPDATE', name: 'Update Vendor', description: 'Edit vendor contact & billing details', category: PERMISSION_CATEGORIES.VENDORS },
  { key: 'VENDOR_DELETE', name: 'Delete Vendor', description: 'Soft-delete vendor records', category: PERMISSION_CATEGORIES.VENDORS },

  // ── Products & BOM ──
  { key: 'PRODUCT_VIEW', name: 'View Products', description: 'View product catalog and custom fields', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'PRODUCT_CREATE', name: 'Create Product', description: 'Create new products and components', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'PRODUCT_UPDATE', name: 'Update Product', description: 'Edit product details, thresholds, and custom fields', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'PRODUCT_DELETE', name: 'Delete Product', description: 'Discontinue or delete products', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'BOM_VIEW', name: 'View Bill of Materials', description: 'View product BOM composition and cost breakdowns', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'BOM_CREATE', name: 'Create Bill of Materials', description: 'Define component requirements for composite products', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'BOM_UPDATE', name: 'Update Bill of Materials', description: 'Replace or edit BOM structure', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },
  { key: 'BOM_DELETE', name: 'Delete Bill of Materials', description: 'Clear product BOM structure', category: PERMISSION_CATEGORIES.PRODUCTS_BOM },

  // ── Production Tasks ──
  { key: 'PRODUCTION_VIEW', name: 'View Production Tasks', description: 'View production tasks and assigned work', category: PERMISSION_CATEGORIES.PRODUCTION },
  { key: 'PRODUCTION_CREATE_TASK', name: 'Create Production Task', description: 'Create new production tasks with batch reservations', category: PERMISSION_CATEGORIES.PRODUCTION },
  { key: 'PRODUCTION_ASSIGN_TASK', name: 'Assign Production Task', description: 'Assign employees to production tasks', category: PERMISSION_CATEGORIES.PRODUCTION },
  { key: 'PRODUCTION_MANAGE_TASK', name: 'Manage Production Tasks', description: 'Cancel, edit, or override production tasks', category: PERMISSION_CATEGORIES.PRODUCTION },
  { key: 'PRODUCTION_REPORT', name: 'Report Production Output', description: 'Report completed output for production tasks', category: PERMISSION_CATEGORIES.PRODUCTION },
  { key: 'PRODUCTION_REPORT_DAMAGE', name: 'Report Material Damage', description: 'Log damaged raw materials during task execution', category: PERMISSION_CATEGORIES.PRODUCTION },
  { key: 'PRODUCTION_MANAGE_REFILL', name: 'Manage Refill Requests', description: 'Request or approve extra raw materials for tasks', category: PERMISSION_CATEGORIES.PRODUCTION },

  // ── Attendance & Overtime ──
  { key: 'ATTENDANCE_VIEW', name: 'View Own Attendance', description: 'View personal attendance logs and daily check-ins', category: PERMISSION_CATEGORIES.ATTENDANCE },
  { key: 'ATTENDANCE_MANAGE', name: 'Manage Attendance Config', description: 'Update required working hours and global rules', category: PERMISSION_CATEGORIES.ATTENDANCE },
  { key: 'ATTENDANCE_VIEW_ALL', name: 'View All Employee Attendance', description: 'View attendance records across all employees', category: PERMISSION_CATEGORIES.ATTENDANCE },
  { key: 'OVERTIME_VIEW', name: 'View Overtime Reports', description: 'View monthly overtime breakdown reports', category: PERMISSION_CATEGORIES.ATTENDANCE },
  { key: 'OVERTIME_DECIDE', name: 'Decide Overtime Requests', description: 'Approve, reject, or edit employee overtime hours', category: PERMISSION_CATEGORIES.ATTENDANCE },
  { key: 'OVERTIME_OVERRIDE', name: 'Override Attendance Logs', description: 'Manually override and correct employee attendance punches', category: PERMISSION_CATEGORIES.ATTENDANCE },

  // ── Payroll & Salary Management ──
  { key: 'PAYROLL_VIEW', name: 'View Own Payroll', description: 'View personal payroll statements and payment history', category: PERMISSION_CATEGORIES.PAYROLL },
  { key: 'PAYROLL_VIEW_ALL', name: 'View All Employee Payroll', description: 'View organization-wide payroll summaries and employee statements', category: PERMISSION_CATEGORIES.PAYROLL },
  { key: 'PAYROLL_MANAGE', name: 'Manage Payroll System', description: 'Full administrative access to payroll workflows', category: PERMISSION_CATEGORIES.PAYROLL },
  { key: 'PAYROLL_RECORD_PAYMENT', name: 'Record Salary Payments', description: 'Record partial or full salary payments to employees', category: PERMISSION_CATEGORIES.PAYROLL },
  { key: 'PAYROLL_UPDATE_RATE', name: 'Update Hourly Rates', description: 'Update employee hourly pay rates and overtime multipliers', category: PERMISSION_CATEGORIES.PAYROLL },
  { key: 'PAYROLL_EXPORT', name: 'Export Payroll Statements', description: 'Download PDF payroll statements and reports', category: PERMISSION_CATEGORIES.PAYROLL },

  // ── Notifications ──
  { key: 'NOTIFICATION_VIEW', name: 'View Notifications', description: 'Receive and view user notifications', category: PERMISSION_CATEGORIES.NOTIFICATIONS },
  { key: 'NOTIFICATION_MANAGE', name: 'Manage Notifications', description: 'Mark as read or clear notifications', category: PERMISSION_CATEGORIES.NOTIFICATIONS },

  // ── Reports & Analytics ──
  { key: 'REPORT_VIEW', name: 'View General Reports', description: 'Access reporting module overview', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_INVENTORY', name: 'View Inventory Reports', description: 'Generate inventory valuation and stock status reports', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_STOCK_MOVEMENTS', name: 'View Stock Movement Reports', description: 'Generate and export stock movement audit logs', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_PRODUCTION', name: 'View Production Reports', description: 'Generate production task output and damage reports', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_ATTENDANCE', name: 'View Attendance Reports', description: 'Generate attendance and overtime analytics reports', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_PAYROLL', name: 'View Payroll Reports', description: 'Generate monthly payroll overview and export summaries', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_EMPLOYEE_PERFORMANCE', name: 'View Performance Reports', description: 'Generate employee performance metrics reports', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_PROFIT', name: 'View Profit Reports', description: 'Generate revenue, cost of goods sold and gross profit reports', category: PERMISSION_CATEGORIES.REPORTS },
  { key: 'REPORT_EXPORT', name: 'Export Reports (PDF/CSV)', description: 'Download PDF and CSV analytical report exports', category: PERMISSION_CATEGORIES.REPORTS },

  // ── Dashboard ──
  { key: 'DASHBOARD_VIEW', name: 'View Dashboard', description: 'View default employee dashboard overview', category: PERMISSION_CATEGORIES.DASHBOARD },
  { key: 'DASHBOARD_ADMIN_VIEW', name: 'View Admin Dashboard', description: 'View full administrative analytics dashboard', category: PERMISSION_CATEGORIES.DASHBOARD },

  // ── Employee Management ──
  { key: 'EMPLOYEE_VIEW', name: 'View Employee Profiles', description: 'View employee list, profiles, and performance details', category: PERMISSION_CATEGORIES.EMPLOYEE_MGMT },
  { key: 'EMPLOYEE_CREATE', name: 'Create Employee', description: 'Create new employee user accounts and profiles', category: PERMISSION_CATEGORIES.EMPLOYEE_MGMT },
  { key: 'EMPLOYEE_UPDATE', name: 'Update Employee', description: 'Edit employee details, profiles, and pay structures', category: PERMISSION_CATEGORIES.EMPLOYEE_MGMT },
  { key: 'EMPLOYEE_DELETE', name: 'Deactivate Employee', description: 'Soft-delete or deactivate employee accounts', category: PERMISSION_CATEGORIES.EMPLOYEE_MGMT },
  // ── Sales & Finished Goods ──
  { key: 'FINISHED_GOODS_VIEW', name: 'View Finished Goods', description: 'View manufactured batches, their production cost and disposal history', category: PERMISSION_CATEGORIES.SALES },
  { key: 'SALES_RECORD', name: 'Record Sales & Disposals', description: 'Sell finished goods to a customer or own store, or write them off', category: PERMISSION_CATEGORIES.SALES },
  { key: 'SALES_REVERSE', name: 'Reverse Sales', description: 'Reverse a recorded disposition and return the stock to its batch', category: PERMISSION_CATEGORIES.SALES },
  { key: 'SALES_SET_PRICE', name: 'Set Selling Prices', description: 'Set the default selling price used for finished goods', category: PERMISSION_CATEGORIES.SALES },
  { key: 'CUSTOMER_VIEW', name: 'View Customers', description: 'View the customer directory', category: PERMISSION_CATEGORIES.SALES },
  { key: 'CUSTOMER_MANAGE', name: 'Manage Customers', description: 'Create, edit and deactivate customers', category: PERMISSION_CATEGORIES.SALES },

  { key: 'EMPLOYEE_MANAGE_PERMISSIONS', name: 'Manage Employee Permissions', description: 'Assign, edit, or revoke delegated permissions for employees', category: PERMISSION_CATEGORIES.EMPLOYEE_MGMT },
];

/**
 * Default base permissions possessed by every EMPLOYEE user out-of-the-box.
 */
export const DEFAULT_EMPLOYEE_PERMISSIONS: string[] = [
  'NOTIFICATION_VIEW',
  'NOTIFICATION_MANAGE',
  'ATTENDANCE_VIEW',
  'PAYROLL_VIEW',
  'DASHBOARD_VIEW',
  'PRODUCT_VIEW',
  'BOM_VIEW',
  'PRODUCTION_VIEW',
  'PRODUCTION_REPORT',
];

/**
 * Convenient Permission Presets for quick assignment in the Admin UI.
 */
export const PERMISSION_PRESETS = {
  NORMAL_EMPLOYEE: DEFAULT_EMPLOYEE_PERMISSIONS,

  /**
   * Sells what the floor produces: can see finished goods and their cost, set
   * prices, record sales and manage the customer directory. Deliberately
   * excludes SALES_REVERSE — undoing a recorded sale is a supervisor action.
   */
  SALES_MANAGER: [
    'DASHBOARD_VIEW',
    'NOTIFICATION_VIEW',
    'PRODUCT_VIEW',
    'INVENTORY_VIEW',
    'FINISHED_GOODS_VIEW',
    'SALES_RECORD',
    'SALES_SET_PRICE',
    'CUSTOMER_VIEW',
    'CUSTOMER_MANAGE',
    'REPORT_VIEW',
    'REPORT_PROFIT',
  ],

  INVENTORY_MANAGER: [
    'INVENTORY_VIEW',
    'INVENTORY_CREATE',
    'INVENTORY_UPDATE',
    'INVENTORY_DELETE',
    'INVENTORY_MANAGE_STOCK',
    'INVENTORY_MANAGE_BATCHES',
    'INVENTORY_VIEW_MOVEMENTS',
    'CATEGORY_VIEW',
    'CATEGORY_CREATE',
    'CATEGORY_UPDATE',
    'CATEGORY_DELETE',
    'VENDOR_VIEW',
    'VENDOR_CREATE',
    'VENDOR_UPDATE',
    'VENDOR_DELETE',
    'PRODUCT_VIEW',
    'PRODUCT_CREATE',
    'PRODUCT_UPDATE',
    'PRODUCT_DELETE',
    'BOM_VIEW',
    'BOM_CREATE',
    'BOM_UPDATE',
    'BOM_DELETE',
    'REPORT_VIEW',
    'REPORT_INVENTORY',
    'REPORT_STOCK_MOVEMENTS',
  ],

  PRODUCTION_MANAGER: [
    'PRODUCT_VIEW',
    'BOM_VIEW',
    'PRODUCTION_VIEW',
    'PRODUCTION_CREATE_TASK',
    'PRODUCTION_ASSIGN_TASK',
    'PRODUCTION_MANAGE_TASK',
    'PRODUCTION_REPORT',
    'PRODUCTION_REPORT_DAMAGE',
    'PRODUCTION_MANAGE_REFILL',
    'INVENTORY_VIEW',
    'INVENTORY_MANAGE_STOCK',
    'REPORT_VIEW',
    'REPORT_PRODUCTION',
  ],

  HR_MANAGER: [
    'EMPLOYEE_VIEW',
    'EMPLOYEE_CREATE',
    'EMPLOYEE_UPDATE',
    'ATTENDANCE_VIEW',
    'ATTENDANCE_VIEW_ALL',
    'ATTENDANCE_MANAGE',
    'OVERTIME_VIEW',
    'OVERTIME_DECIDE',
    'OVERTIME_OVERRIDE',
    'REPORT_VIEW',
    'REPORT_ATTENDANCE',
    'REPORT_EMPLOYEE_PERFORMANCE',
  ],

  PAYROLL_MANAGER: [
    'EMPLOYEE_VIEW',
    'PAYROLL_VIEW',
    'PAYROLL_VIEW_ALL',
    'PAYROLL_MANAGE',
    'PAYROLL_RECORD_PAYMENT',
    'PAYROLL_UPDATE_RATE',
    'PAYROLL_EXPORT',
    'REPORT_VIEW',
    'REPORT_PAYROLL',
  ],

  OPERATIONS_MANAGER: [
    'INVENTORY_VIEW',
    'INVENTORY_CREATE',
    'INVENTORY_UPDATE',
    'INVENTORY_MANAGE_STOCK',
    'INVENTORY_MANAGE_BATCHES',
    'INVENTORY_VIEW_MOVEMENTS',
    'PRODUCT_VIEW',
    'PRODUCT_CREATE',
    'PRODUCT_UPDATE',
    'BOM_VIEW',
    'BOM_CREATE',
    'BOM_UPDATE',
    'PRODUCTION_VIEW',
    'PRODUCTION_CREATE_TASK',
    'PRODUCTION_ASSIGN_TASK',
    'PRODUCTION_MANAGE_TASK',
    'PRODUCTION_REPORT',
    'PRODUCTION_REPORT_DAMAGE',
    'PRODUCTION_MANAGE_REFILL',
    'ATTENDANCE_VIEW',
    'ATTENDANCE_VIEW_ALL',
    'OVERTIME_VIEW',
    'OVERTIME_DECIDE',
    'REPORT_VIEW',
    'REPORT_INVENTORY',
    'REPORT_STOCK_MOVEMENTS',
    'REPORT_PRODUCTION',
    'REPORT_ATTENDANCE',
    'DASHBOARD_VIEW',
    'DASHBOARD_ADMIN_VIEW',
  ],

  FULL_ACCESS_EMPLOYEE: SYSTEM_PERMISSIONS
    .map((p) => p.key)
    .filter((key) => key !== 'EMPLOYEE_MANAGE_PERMISSIONS'),
} as const;
