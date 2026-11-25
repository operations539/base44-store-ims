import { denied } from './util.js';

export const ROLES = ['admin', 'owner', 'store_manager', 'store_exec', 'store_helper', 'supervisor'];

export const ROLE_LABELS = {
  admin: 'MIS & System Builder',
  owner: 'Owners & VP',
  store_manager: 'Store Manager',
  store_exec: 'Store Executive',
  store_helper: 'Store Helper',
  supervisor: 'Site Supervisor',
};

export const ROLE_TAGS = {
  admin: 'Admin',
  owner: 'Executive',
  store_manager: 'Store',
  store_exec: 'Store',
  store_helper: 'Store · Mobile',
  supervisor: 'Site · Mobile',
};

export const PERMISSIONS = {
  admin: [
    'admin.manage', 'users.manage', 'import.manage', 'demo.reset', 'settings.manage',
    'masters.read', 'masters.write',
    'stock.read', 'stock.price.read',
    'mrn.read', 'mrn.create', 'mrn.approve',
    'po.read', 'po.create', 'po.approve',
    'challan.read', 'challan.create', 'challan.deliver', 'challan.inspect',
    'purchase.read', 'purchase.create',
    'returns.read', 'returns.raise', 'returns.pickup', 'returns.receive', 'returns.post',
    'dashboards.read', 'audit.read', 'exports.run',
    'packing.read', 'signed_dc.upload', 'tracking.read',
  ],
  owner: [
    'masters.read',
    'stock.read', 'stock.price.read',
    'mrn.read', 'po.read', 'po.approve', 'challan.read', 'purchase.read', 'returns.read',
    'dashboards.read', 'audit.read', 'exports.run', 'tracking.read',
  ],
  store_manager: [
    'masters.read',
    'stock.read', 'stock.price.read',
    'mrn.read', 'mrn.approve', 'po.read', 'po.create', 'po.approve',
    'challan.read', 'challan.create', 'challan.deliver', 'challan.inspect',
    'purchase.read', 'purchase.create',
    'returns.read', 'returns.pickup', 'returns.receive', 'returns.post',
    'dashboards.read', 'exports.run', 'tracking.read',
  ],
  store_exec: [
    'masters.read',
    'stock.read', 'stock.price.read',
    'mrn.read', 'po.read', 'po.create',
    'challan.read', 'challan.create', 'challan.deliver',
    'purchase.read', 'purchase.create',
    'returns.read', 'returns.pickup', 'returns.receive',
    'dashboards.read', 'exports.run', 'tracking.read',
  ],
  store_helper: ['packing.read', 'signed_dc.upload', 'challan.read', 'returns.receive'],
  supervisor: ['mrn.create', 'mrn.read', 'returns.raise', 'returns.read', 'tracking.read'],
};

export function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

export function permissionsFor(role) {
  return PERMISSIONS[role] || [];
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(denied('Sign in to continue.'));
    if (!can(req.user.role, permission)) {
      return next(denied('Your role does not allow this action.'));
    }
    return next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(denied('Sign in to continue.'));
    if (!roles.includes(req.user.role)) return next(denied('Your role does not allow this action.'));
    return next();
  };
}

/** Mobile-only roles get the bottom-tab shell. */
export const MOBILE_ROLES = ['store_helper', 'supervisor'];

export function navFor(role) {
  if (role === 'store_helper') {
    return [
      { to: '/m/packing', label: 'Packing Lists', icon: 'list' },
      { to: '/m/scan', label: 'Scan & Upload', icon: 'camera' },
    ];
  }
  if (role === 'supervisor') {
    return [
      { to: '/m/requests', label: 'Requests', icon: 'list' },
      { to: '/m/returns', label: 'Returns', icon: 'return' },
      { to: '/m/tracking', label: 'Tracking', icon: 'truck' },
    ];
  }
  const nav = [{ to: '/', label: 'Dashboard', icon: 'grid' }];
  if (can(role, 'stock.read')) nav.push({ to: '/stock', label: 'Live Stock', icon: 'box' });
  if (can(role, 'masters.read')) {
    nav.push({
      group: 'Masters',
      items: [
        { to: '/masters/items', label: 'Items Master', icon: 'tag' },
        { to: '/masters/sites', label: 'Sites Master', icon: 'pin' },
        { to: '/masters/vendors', label: 'Vendors Master', icon: 'building' },
      ],
    });
  }
  if (can(role, 'audit.read')) nav.push({ to: '/audit', label: 'Audit Logs', icon: 'shield' });
  if (can(role, 'admin.manage')) {
    nav.push({
      group: 'Administration',
      items: [
        { to: '/admin/users', label: 'Users & Roles', icon: 'users' },
        { to: '/admin/import', label: 'Master Import', icon: 'upload' },
        { to: '/admin/data', label: 'Demo Data', icon: 'database' },
      ],
    });
  }
  return nav;
}
