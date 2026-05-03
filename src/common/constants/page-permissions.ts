import { UserRole } from '@prisma/client';

export const PAGE_PERMISSION_KEYS = [
  'dashboard',
  'invoices',
  'accounts',
  'products',
  'stock',
  'accounting',
  'expenses',
  'work_orders',
  'reports',
  'companies',
  'settings',
] as const;

export type PagePermissionKey = (typeof PAGE_PERMISSION_KEYS)[number];

export type PagePermissionValue = {
  enabled: boolean;
  editable: boolean;
};

export type PagePermissionMap = Record<PagePermissionKey, PagePermissionValue>;

function all(enabled: boolean, editable: boolean): PagePermissionMap {
  return PAGE_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = { enabled, editable };
    return acc;
  }, {} as PagePermissionMap);
}

export const ROLE_PERMISSION_DEFAULTS: Record<UserRole, PagePermissionMap> = {
  SUPER_ADMIN: all(true, true),
  TENANT_ADMIN: all(true, true),
  MANAGER: {
    dashboard: { enabled: true, editable: false },
    invoices: { enabled: true, editable: true },
    accounts: { enabled: true, editable: true },
    products: { enabled: true, editable: true },
    stock: { enabled: true, editable: true },
    accounting: { enabled: false, editable: false },
    expenses: { enabled: true, editable: true },
    work_orders: { enabled: true, editable: true },
    reports: { enabled: true, editable: false },
    companies: { enabled: false, editable: false },
    settings: { enabled: false, editable: false },
  },
  ACCOUNTANT: {
    dashboard: { enabled: true, editable: false },
    invoices: { enabled: true, editable: false },
    accounts: { enabled: true, editable: false },
    products: { enabled: false, editable: false },
    stock: { enabled: false, editable: false },
    accounting: { enabled: true, editable: false },
    expenses: { enabled: false, editable: false },
    work_orders: { enabled: false, editable: false },
    reports: { enabled: true, editable: false },
    companies: { enabled: false, editable: false },
    settings: { enabled: false, editable: false },
  },
  VIEWER: all(true, false),
};

export function clonePagePermissions(
  source: PagePermissionMap,
): PagePermissionMap {
  return JSON.parse(JSON.stringify(source)) as PagePermissionMap;
}

export function normalizePagePermissions(
  raw: unknown,
  fallbackRole: UserRole,
): PagePermissionMap {
  // Ensure the fallback role is valid and exists in defaults
  const validRole = (ROLE_PERMISSION_DEFAULTS as Record<string, any>)[fallbackRole];
  if (!validRole) {
    // Fallback to VIEWER if role is somehow invalid
    console.warn(
      `[normalizePagePermissions] Invalid role "${fallbackRole}" provided, defaulting to VIEWER permissions`,
    );
    return clonePagePermissions(ROLE_PERMISSION_DEFAULTS.VIEWER);
  }

  const fallback = clonePagePermissions(validRole);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fallback;
  }

  const input = raw as Record<string, unknown>;
  for (const key of PAGE_PERMISSION_KEYS) {
    const row = input[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const enabled = (row as Record<string, unknown>).enabled;
    const editable = (row as Record<string, unknown>).editable;
    fallback[key] = {
      enabled: enabled === true,
      editable: enabled === true && editable === true,
    };
  }

  return fallback;
}
