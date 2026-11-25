import { Router } from 'express';
import { query, tx } from '../db.js';
import { can, requirePermission } from '../rbac.js';
import {
  TAX_SLABS,
  UNITS,
  HttpError,
  denied,
  normalizeGstin,
  normalizePhone,
  num,
  requiredStr,
  str,
  wrap,
} from '../util.js';
import { writeAudit } from '../audit.js';

const router = Router();

const ITEM_BASE = `id, item_code, category, prod_category, item_name, model_no, unit,
  tax_percent, store_physical_stock, min_qty_alert, scrap_qty, is_demo, created_at`;

/** Pricing columns are only selected for roles that may see rates. */
function itemColumns(req) {
  return can(req.user.role, 'stock.price.read') ? `${ITEM_BASE}, latest_rate` : ITEM_BASE;
}

function shapeItem(row, withPrice) {
  const item = { ...row };
  if (!withPrice) delete item.latest_rate;
  item.store_physical_stock = Number(item.store_physical_stock);
  item.scrap_qty = Number(item.scrap_qty);
  item.min_qty_alert = Number(item.min_qty_alert);
  item.is_negative = item.store_physical_stock < 0;
  item.below_min = item.min_qty_alert > 0 && item.store_physical_stock < item.min_qty_alert;
  return item;
}

// ------------------------------- Items -------------------------------
router.get(
  '/items',
  requirePermission('masters.read'),
  wrap(async (req, res) => {
    const withPrice = can(req.user.role, 'stock.price.read');
    const params = [];
    const where = [];
    if (req.query.category && ['High Side', 'Low Side'].includes(req.query.category)) {
      params.push(req.query.category);
      where.push(`category = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(lower(item_name) LIKE $${params.length} OR lower(item_code) LIKE $${params.length}
                   OR lower(COALESCE(model_no,'')) LIKE $${params.length})`);
    }
    const sql = `SELECT ${itemColumns(req)} FROM items_master
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                  ORDER BY category, item_name LIMIT 500`;
    const { rows } = await query(sql, params);
    res.json({ items: rows.map((r) => shapeItem(r, withPrice)), pricingVisible: withPrice });
  })
);

function itemPayload(body, existing = null) {
  const item = {
    item_code: body.item_code !== undefined ? requiredStr(body.item_code, 'Item code', { max: 60 }) : existing.item_code,
    category: body.category !== undefined ? String(body.category) : existing.category,
    prod_category: body.prod_category !== undefined ? str(body.prod_category, { max: 120 }) : existing.prod_category,
    item_name: body.item_name !== undefined ? requiredStr(body.item_name, 'Item name', { max: 200 }) : existing.item_name,
    model_no: body.model_no !== undefined ? str(body.model_no, { max: 120 }) : existing.model_no,
    unit: body.unit !== undefined ? String(body.unit) : existing.unit,
    tax_percent: body.tax_percent !== undefined ? num(body.tax_percent, { field: 'Tax %', def: 18 }) : existing.tax_percent,
    min_qty_alert: body.min_qty_alert !== undefined ? num(body.min_qty_alert, { field: 'Min qty', min: 0, def: 0 }) : existing.min_qty_alert,
    latest_rate: body.latest_rate !== undefined ? num(body.latest_rate, { field: 'Latest rate', min: 0, def: 0 }) : existing.latest_rate,
  };
  if (!['High Side', 'Low Side'].includes(item.category)) {
    throw new HttpError(400, 'Choose High Side or Low Side.', { category: 'Required' });
  }
  if (!UNITS.includes(item.unit)) throw new HttpError(400, 'Choose a valid unit.', { unit: 'Invalid unit' });
  if (!TAX_SLABS.includes(Number(item.tax_percent))) {
    throw new HttpError(400, 'Choose a valid GST slab.', { tax_percent: 'Invalid GST slab' });
  }
  return item;
}

router.post(
  '/items',
  requirePermission('masters.write'),
  wrap(async (req, res) => {
    const item = itemPayload(req.body || {});
    const dup = await query('SELECT 1 FROM items_master WHERE lower(item_code) = lower($1)', [item.item_code]);
    if (dup.rows.length) throw new HttpError(400, 'That item code already exists.', { item_code: 'Already exists' });

    const created = await tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO items_master (item_code, category, prod_category, item_name, model_no, unit,
                                   tax_percent, min_qty_alert, latest_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ITEM_BASE}, latest_rate`,
        [item.item_code, item.category, item.prod_category, item.item_name, item.model_no,
         item.unit, item.tax_percent, item.min_qty_alert, item.latest_rate]
      );
      await writeAudit(client, req, {
        module: 'Masters',
        recordType: 'items_master',
        recordId: rows[0].id,
        action: 'CREATE_ITEM',
        newValues: item,
      });
      return rows[0];
    });
    res.status(201).json({ item: shapeItem(created, true) });
  })
);

router.patch(
  '/items/:id',
  requirePermission('masters.write'),
  wrap(async (req, res) => {
    const { rows: found } = await query(`SELECT ${ITEM_BASE}, latest_rate FROM items_master WHERE id = $1`, [req.params.id]);
    const existing = found[0];
    if (!existing) throw new HttpError(404, 'Item not found.');
    const item = itemPayload(req.body || {}, existing);

    const updated = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE items_master SET item_code=$2, category=$3, prod_category=$4, item_name=$5,
                model_no=$6, unit=$7, tax_percent=$8, min_qty_alert=$9, latest_rate=$10
          WHERE id = $1 RETURNING ${ITEM_BASE}, latest_rate`,
        [req.params.id, item.item_code, item.category, item.prod_category, item.item_name,
         item.model_no, item.unit, item.tax_percent, item.min_qty_alert, item.latest_rate]
      );
      await writeAudit(client, req, {
        module: 'Masters',
        recordType: 'items_master',
        recordId: req.params.id,
        action: 'UPDATE_ITEM',
        oldValues: existing,
        newValues: item,
      });
      return rows[0];
    });
    res.json({ item: shapeItem(updated, true) });
  })
);

// ------------------------------- Live stock -------------------------------
router.get(
  '/stock',
  requirePermission('stock.read'),
  wrap(async (req, res) => {
    const withPrice = can(req.user.role, 'stock.price.read');
    const { rows } = await query(
      `SELECT ${itemColumns(req)} FROM items_master ORDER BY category DESC, item_name`
    );
    const items = rows.map((r) => shapeItem(r, withPrice));
    res.json({
      items,
      pricingVisible: withPrice,
      summary: {
        highSide: items.filter((i) => i.category === 'High Side').length,
        lowSide: items.filter((i) => i.category === 'Low Side').length,
        negative: items.filter((i) => i.is_negative).length,
        belowMin: items.filter((i) => i.below_min).length,
      },
    });
  })
);

// ------------------------------- Sites -------------------------------
const SITE_COLUMNS = `s.id, s.site_project_id, s.client_project_name, s.full_site_address,
  s.assigned_supervisor_id, s.status, s.is_demo, s.created_at,
  u.full_name AS supervisor_name, u.phone AS supervisor_phone`;

/** Supervisors may read their own assigned sites without the masters module. */
function canReadSites(req, res, next) {
  if (!req.user) return next(denied('Sign in to continue.'));
  if (can(req.user.role, 'masters.read') || req.user.role === 'supervisor') return next();
  return next(denied('Your role does not allow this action.'));
}

router.get(
  '/sites',
  canReadSites,
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `WHERE s.assigned_supervisor_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT ${SITE_COLUMNS} FROM sites_master s
         LEFT JOIN users u ON u.id = s.assigned_supervisor_id
         ${scope}
        ORDER BY s.site_project_id`,
      params
    );
    res.json({ sites: rows });
  })
);

async function validateSupervisor(client, id) {
  if (!id) return null;
  const { rows } = await client.query("SELECT id, role FROM users WHERE id = $1 AND role = 'supervisor'", [id]);
  if (!rows.length) throw new HttpError(400, 'Assigned supervisor must be a Site Supervisor user.', {
    assigned_supervisor_id: 'Invalid supervisor',
  });
  return id;
}

router.post(
  '/sites',
  requirePermission('masters.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const siteProjectId = requiredStr(body.site_project_id, 'Site / Project ID', { max: 60 });
    const name = requiredStr(body.client_project_name, 'Client project name', { max: 200 });
    const status = body.status === 'Closed' ? 'Closed' : 'Active';

    const created = await tx(async (client) => {
      const supervisorId = await validateSupervisor(client, str(body.assigned_supervisor_id));
      const dup = await client.query('SELECT 1 FROM sites_master WHERE lower(site_project_id) = lower($1)', [siteProjectId]);
      if (dup.rows.length) throw new HttpError(400, 'That site/project ID already exists.', { site_project_id: 'Already exists' });
      const { rows } = await client.query(
        `INSERT INTO sites_master (site_project_id, client_project_name, full_site_address,
                                   assigned_supervisor_id, status)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [siteProjectId, name, str(body.full_site_address, { max: 500 }), supervisorId, status]
      );
      await writeAudit(client, req, {
        module: 'Masters',
        recordType: 'sites_master',
        recordId: rows[0].id,
        action: 'CREATE_SITE',
        newValues: { site_project_id: siteProjectId, client_project_name: name, status },
      });
      return rows[0].id;
    });

    const { rows } = await query(
      `SELECT ${SITE_COLUMNS} FROM sites_master s LEFT JOIN users u ON u.id = s.assigned_supervisor_id WHERE s.id = $1`,
      [created]
    );
    res.status(201).json({ site: rows[0] });
  })
);

router.patch(
  '/sites/:id',
  requirePermission('masters.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const { rows: found } = await query('SELECT * FROM sites_master WHERE id = $1', [req.params.id]);
    const existing = found[0];
    if (!existing) throw new HttpError(404, 'Site not found.');

    await tx(async (client) => {
      const supervisorId =
        body.assigned_supervisor_id !== undefined
          ? await validateSupervisor(client, str(body.assigned_supervisor_id))
          : existing.assigned_supervisor_id;
      await client.query(
        `UPDATE sites_master SET site_project_id=$2, client_project_name=$3, full_site_address=$4,
                assigned_supervisor_id=$5, status=$6 WHERE id=$1`,
        [
          req.params.id,
          body.site_project_id !== undefined ? requiredStr(body.site_project_id, 'Site / Project ID') : existing.site_project_id,
          body.client_project_name !== undefined ? requiredStr(body.client_project_name, 'Client project name') : existing.client_project_name,
          body.full_site_address !== undefined ? str(body.full_site_address, { max: 500 }) : existing.full_site_address,
          supervisorId,
          body.status !== undefined ? (body.status === 'Closed' ? 'Closed' : 'Active') : existing.status,
        ]
      );
      await writeAudit(client, req, {
        module: 'Masters',
        recordType: 'sites_master',
        recordId: req.params.id,
        action: 'UPDATE_SITE',
        oldValues: existing,
        newValues: body,
      });
    });

    const { rows } = await query(
      `SELECT ${SITE_COLUMNS} FROM sites_master s LEFT JOIN users u ON u.id = s.assigned_supervisor_id WHERE s.id = $1`,
      [req.params.id]
    );
    res.json({ site: rows[0] });
  })
);

// ------------------------------- Vendors -------------------------------
const VENDOR_COLUMNS = `id, vendor_id, vendor_name, full_address, gstin, contact_persons,
  status, is_demo, created_at`;

function contactsPayload(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((c) => ({
      name: str(c?.name, { max: 120 }),
      designation: str(c?.designation, { max: 120 }),
      phone: normalizePhone(c?.phone),
      email: str(c?.email, { max: 160 }),
    }))
    .filter((c) => c.name || c.phone || c.email);
}

router.get(
  '/vendors',
  requirePermission('masters.read'),
  wrap(async (req, res) => {
    const { rows } = await query(`SELECT ${VENDOR_COLUMNS} FROM vendors_master ORDER BY vendor_name`);
    res.json({ vendors: rows });
  })
);

router.post(
  '/vendors',
  requirePermission('masters.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const vendorCode = requiredStr(body.vendor_id, 'Vendor ID', { max: 60 });
    const vendorName = requiredStr(body.vendor_name, 'Vendor name', { max: 200 });
    const gstinRaw = str(body.gstin, { max: 15 });
    const gstin = gstinRaw ? normalizeGstin(gstinRaw) : null;
    if (gstinRaw && !gstin) throw new HttpError(400, 'GSTIN must be a valid 15-character GST number.', { gstin: 'Invalid GSTIN' });

    const created = await tx(async (client) => {
      const dup = await client.query('SELECT 1 FROM vendors_master WHERE lower(vendor_id) = lower($1)', [vendorCode]);
      if (dup.rows.length) throw new HttpError(400, 'That vendor ID already exists.', { vendor_id: 'Already exists' });
      const { rows } = await client.query(
        `INSERT INTO vendors_master (vendor_id, vendor_name, full_address, gstin, contact_persons, status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${VENDOR_COLUMNS}`,
        [vendorCode, vendorName, str(body.full_address, { max: 500 }), gstin,
         JSON.stringify(contactsPayload(body.contact_persons)),
         body.status === 'Inactive' ? 'Inactive' : 'Active']
      );
      await writeAudit(client, req, {
        module: 'Masters',
        recordType: 'vendors_master',
        recordId: rows[0].id,
        action: 'CREATE_VENDOR',
        newValues: { vendor_id: vendorCode, vendor_name: vendorName, gstin },
      });
      return rows[0];
    });
    res.status(201).json({ vendor: created });
  })
);

router.patch(
  '/vendors/:id',
  requirePermission('masters.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const { rows: found } = await query('SELECT * FROM vendors_master WHERE id = $1', [req.params.id]);
    const existing = found[0];
    if (!existing) throw new HttpError(404, 'Vendor not found.');

    const gstinRaw = body.gstin !== undefined ? str(body.gstin, { max: 15 }) : existing.gstin;
    const gstin = gstinRaw ? normalizeGstin(gstinRaw) : null;
    if (gstinRaw && !gstin) throw new HttpError(400, 'GSTIN must be a valid 15-character GST number.', { gstin: 'Invalid GSTIN' });

    const updated = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE vendors_master SET vendor_id=$2, vendor_name=$3, full_address=$4, gstin=$5,
                contact_persons=$6, status=$7 WHERE id=$1 RETURNING ${VENDOR_COLUMNS}`,
        [
          req.params.id,
          body.vendor_id !== undefined ? requiredStr(body.vendor_id, 'Vendor ID') : existing.vendor_id,
          body.vendor_name !== undefined ? requiredStr(body.vendor_name, 'Vendor name') : existing.vendor_name,
          body.full_address !== undefined ? str(body.full_address, { max: 500 }) : existing.full_address,
          gstin,
          body.contact_persons !== undefined ? JSON.stringify(contactsPayload(body.contact_persons)) : existing.contact_persons,
          body.status !== undefined ? (body.status === 'Inactive' ? 'Inactive' : 'Active') : existing.status,
        ]
      );
      await writeAudit(client, req, {
        module: 'Masters',
        recordType: 'vendors_master',
        recordId: req.params.id,
        action: 'UPDATE_VENDOR',
        oldValues: existing,
        newValues: body,
      });
      return rows[0];
    });
    res.json({ vendor: updated });
  })
);

export default router;
