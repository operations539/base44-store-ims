import { Router } from 'express';
import { pool, query, tx, recomputeItemBalances } from '../db.js';
import { requirePermission } from '../rbac.js';
import {
  TAX_SLABS,
  UNITS,
  HttpError,
  normalizeGstin,
  normalizePhone,
  num,
  parseCsv,
  requiredStr,
  str,
  toCsv,
  wrap,
} from '../util.js';
import { writeAudit } from '../audit.js';

const router = Router();

export const IMPORT_TYPES = {
  items: {
    label: 'Items Master',
    headers: ['Item_Code', 'Category', 'Prod_Category', 'Item_Name', 'Model_No', 'Unit',
      'Tax_Percent', 'Min_Qty_Alert', 'Latest_Rate'],
    sample: ['KMHS-011', 'High Side', 'VRF Outdoor', 'VRV Outdoor Unit 12 HP', 'RXQ12ARY16',
      'nos', '18', '1', '410000'],
  },
  sites: {
    label: 'Sites Master',
    headers: ['Site_Project_ID', 'Client_Project_Name', 'Full_Site_Address', 'Supervisor_Email', 'Status'],
    sample: ['SP-005', 'Sample Client Project', 'Sector 21, Noida, Uttar Pradesh 201301',
      'suresh@koolmart.in', 'Active'],
  },
  vendors: {
    label: 'Vendors Master',
    headers: ['Vendor_ID', 'Vendor_Name', 'Full_Address', 'GSTIN', 'Contact_Name',
      'Contact_Designation', 'Contact_Phone', 'Contact_Email', 'Status'],
    sample: ['V-006', 'Sample Cooling Solutions', 'Andheri East, Mumbai, Maharashtra 400069',
      '27AABCS4321K1Z9', 'Rohit Shah', 'Sales Head', '9876543210', 'rohit@example.com', 'Active'],
  },
  opening_stock: {
    label: 'Opening Stock',
    headers: ['Item_Code', 'Opening_Qty', 'Unit', 'Remarks'],
    sample: ['KMLS-001', '250', 'mtr', 'FY 2026-27 opening'],
  },
};

router.get(
  '/import/template/:type',
  requirePermission('import.manage'),
  wrap(async (req, res) => {
    const def = IMPORT_TYPES[req.params.type];
    if (!def) throw new HttpError(404, 'Unknown import type.');
    const csv = toCsv(def.headers, [Object.fromEntries(def.headers.map((h, i) => [h, def.sample[i]]))]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="koolmart-${req.params.type}-template.csv"`);
    res.send(csv);
  })
);

function blank(v) {
  return v === undefined || v === null || v === '';
}

/** Numeric parse that records a row-level error instead of aborting the whole file. */
function tryNum(value, opts, errors, key) {
  try {
    return num(value, opts);
  } catch {
    errors[key] = opts?.min !== undefined ? `Must be a number (min ${opts.min})` : 'Must be a number';
    return null;
  }
}

/** Validate + normalise one CSV row. Returns { data, errors }. */
async function validateRow(client, type, rec) {
  const errors = {};

  if (type === 'items') {
    const data = {
      item_code: str(rec.Item_Code, { max: 60 }),
      category: str(rec.Category),
      prod_category: str(rec.Prod_Category, { max: 120 }),
      item_name: str(rec.Item_Name, { max: 200 }),
      model_no: str(rec.Model_No, { max: 120 }),
      unit: (str(rec.Unit) || '').toLowerCase(),
      tax_percent: tryNum(rec.Tax_Percent, { field: 'Tax_Percent', def: 18 }, errors, 'Tax_Percent'),
      min_qty_alert: tryNum(rec.Min_Qty_Alert, { field: 'Min_Qty_Alert', min: 0, def: 0 }, errors, 'Min_Qty_Alert'),
      latest_rate: tryNum(rec.Latest_Rate, { field: 'Latest_Rate', min: 0, def: 0 }, errors, 'Latest_Rate'),
    };
    if (!data.item_code) errors.Item_Code = 'Required';
    if (!['High Side', 'Low Side'].includes(data.category)) errors.Category = 'High Side or Low Side';
    if (!data.item_name) errors.Item_Name = 'Required';
    if (!UNITS.includes(data.unit)) errors.Unit = `One of ${UNITS.join(', ')}`;
    if (data.tax_percent === null || !TAX_SLABS.includes(Number(data.tax_percent))) {
      errors.Tax_Percent = errors.Tax_Percent || '0/5/12/18/28';
    }
    return { data, errors };
  }

  if (type === 'sites') {
    const data = {
      site_project_id: str(rec.Site_Project_ID, { max: 60 }),
      client_project_name: str(rec.Client_Project_Name, { max: 200 }),
      full_site_address: str(rec.Full_Site_Address, { max: 500 }),
      status: rec.Status === 'Closed' ? 'Closed' : 'Active',
      supervisor_email: str(rec.Supervisor_Email, { max: 160 })?.toLowerCase() || null,
      assigned_supervisor_id: null,
    };
    if (!data.site_project_id) errors.Site_Project_ID = 'Required';
    if (!data.client_project_name) errors.Client_Project_Name = 'Required';
    if (data.supervisor_email) {
      const { rows } = await client.query(
        "SELECT id FROM users WHERE lower(email) = $1 AND role = 'supervisor'",
        [data.supervisor_email]
      );
      if (!rows.length) errors.Supervisor_Email = 'No supervisor with that email';
      else data.assigned_supervisor_id = rows[0].id;
    }
    return { data, errors };
  }

  if (type === 'vendors') {
    const gstinRaw = str(rec.GSTIN, { max: 20 });
    const data = {
      vendor_id: str(rec.Vendor_ID, { max: 60 }),
      vendor_name: str(rec.Vendor_Name, { max: 200 }),
      full_address: str(rec.Full_Address, { max: 500 }),
      gstin: gstinRaw ? normalizeGstin(gstinRaw) : null,
      status: rec.Status === 'Inactive' ? 'Inactive' : 'Active',
      contact_persons: [],
    };
    if (!data.vendor_id) errors.Vendor_ID = 'Required';
    if (!data.vendor_name) errors.Vendor_Name = 'Required';
    if (gstinRaw && !data.gstin) errors.GSTIN = 'Invalid 15-character GSTIN';
    const phone = normalizePhone(rec.Contact_Phone);
    if (rec.Contact_Phone && !phone) errors.Contact_Phone = 'Invalid Indian mobile';
    if (rec.Contact_Name || phone || rec.Contact_Email) {
      data.contact_persons.push({
        name: str(rec.Contact_Name, { max: 120 }),
        designation: str(rec.Contact_Designation, { max: 120 }),
        phone,
        email: str(rec.Contact_Email, { max: 160 }),
      });
    }
    return { data, errors };
  }

  // opening_stock
  const data = {
    item_code: str(rec.Item_Code, { max: 60 }),
    qty: tryNum(rec.Opening_Qty, { field: 'Opening_Qty' }, errors, 'Opening_Qty'),
    unit: (str(rec.Unit) || '').toLowerCase() || null,
    remarks: str(rec.Remarks, { max: 300 }),
    item_id: null,
    unit_of_item: null,
  };
  if (!data.item_code) errors.Item_Code = 'Required';
  if (data.qty === null || Number.isNaN(data.qty)) errors.Opening_Qty = 'Numeric quantity required';
  if (data.item_code) {
    const { rows } = await client.query('SELECT id, unit FROM items_master WHERE lower(item_code) = lower($1)', [data.item_code]);
    if (!rows.length) errors.Item_Code = 'Item not found';
    else {
      data.item_id = rows[0].id;
      data.unit_of_item = rows[0].unit;
    }
  }
  return { data, errors };
}

async function prepare(type, records, mode) {
  const client = await pool.connect();
  try {
    const rows = [];
    const summary = { total: records.length, new: 0, update: 0, skip: 0, error: 0 };

    for (let i = 0; i < records.length; i += 1) {
      const { data, errors } = await validateRow(client, type, records[i]);
      let status = 'new';
      let existingId = null;

      if (!Object.keys(errors).length) {
        if (type === 'items') {
          const { rows: hit } = await client.query('SELECT id FROM items_master WHERE lower(item_code) = lower($1)', [data.item_code]);
          if (hit.length) {
            existingId = hit[0].id;
            status = mode === 'add_only' ? 'skip' : 'update';
          }
        } else if (type === 'sites') {
          const { rows: hit } = await client.query('SELECT id FROM sites_master WHERE lower(site_project_id) = lower($1)', [data.site_project_id]);
          if (hit.length) {
            existingId = hit[0].id;
            status = mode === 'add_only' ? 'skip' : 'update';
          }
        } else if (type === 'vendors') {
          const { rows: hit } = await client.query('SELECT id FROM vendors_master WHERE lower(vendor_id) = lower($1)', [data.vendor_id]);
          if (hit.length) {
            existingId = hit[0].id;
            status = mode === 'add_only' ? 'skip' : 'update';
          }
        }
      }

      if (Object.keys(errors).length) status = 'error';
      summary[status] += 1;
      rows.push({ row: i + 2, status, errors, data, existing_id: existingId });
    }
    return { rows, summary };
  } finally {
    client.release();
  }
}

router.post(
  '/import/preview',
  requirePermission('import.manage'),
  wrap(async (req, res) => {
    const { type, csv } = req.body || {};
    const mode = req.body?.mode === 'add_only' ? 'add_only' : 'upsert';
    if (!IMPORT_TYPES[type]) throw new HttpError(400, 'Unknown import type.');
    const parsed = parseCsv(csv);
    if (!parsed.records.length) throw new HttpError(400, 'That file has no data rows.');
    if (parsed.records.length > 2000) throw new HttpError(400, 'Import at most 2000 rows per file.');
    const result = await prepare(type, parsed.records, mode);
    res.json({ type, mode, headers: parsed.headers, ...result });
  })
);

router.post(
  '/import/commit',
  requirePermission('import.manage'),
  wrap(async (req, res) => {
    const { type, csv } = req.body || {};
    const mode = req.body?.mode === 'add_only' ? 'add_only' : 'upsert';
    if (!IMPORT_TYPES[type]) throw new HttpError(400, 'Unknown import type.');
    const parsed = parseCsv(csv);
    const prepared = await prepare(type, parsed.records, mode);

    if (prepared.summary.error > 0) {
      throw new HttpError(400, `${prepared.summary.error} row(s) still have errors. Fix them before saving.`);
    }

    const applied = await tx(async (client) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const touchedItems = [];

      for (const row of prepared.rows) {
        if (row.status === 'skip') {
          skipped += 1;
          continue;
        }
        const d = row.data;

        if (type === 'items') {
          if (row.status === 'update') {
            await client.query(
              `UPDATE items_master SET category=$2, prod_category=$3, item_name=$4, model_no=$5,
                      unit=$6, tax_percent=$7, min_qty_alert=$8, latest_rate=$9
                WHERE id=$1`,
              [row.existing_id, d.category, d.prod_category, d.item_name, d.model_no,
               d.unit, d.tax_percent, d.min_qty_alert, d.latest_rate]
            );
            updated += 1;
          } else {
            await client.query(
              `INSERT INTO items_master (item_code, category, prod_category, item_name, model_no,
                                         unit, tax_percent, min_qty_alert, latest_rate, is_demo)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
              [d.item_code, d.category, d.prod_category, d.item_name, d.model_no,
               d.unit, d.tax_percent, d.min_qty_alert, d.latest_rate]
            );
            inserted += 1;
          }
        } else if (type === 'sites') {
          if (row.status === 'update') {
            await client.query(
              `UPDATE sites_master SET client_project_name=$2, full_site_address=$3,
                      assigned_supervisor_id=$4, status=$5 WHERE id=$1`,
              [row.existing_id, d.client_project_name, d.full_site_address, d.assigned_supervisor_id, d.status]
            );
            updated += 1;
          } else {
            await client.query(
              `INSERT INTO sites_master (site_project_id, client_project_name, full_site_address,
                                         assigned_supervisor_id, status, is_demo)
               VALUES ($1,$2,$3,$4,$5,false)`,
              [d.site_project_id, d.client_project_name, d.full_site_address, d.assigned_supervisor_id, d.status]
            );
            inserted += 1;
          }
        } else if (type === 'vendors') {
          if (row.status === 'update') {
            await client.query(
              `UPDATE vendors_master SET vendor_name=$2, full_address=$3, gstin=$4,
                      contact_persons=$5, status=$6 WHERE id=$1`,
              [row.existing_id, d.vendor_name, d.full_address, d.gstin,
               JSON.stringify(d.contact_persons), d.status]
            );
            updated += 1;
          } else {
            await client.query(
              `INSERT INTO vendors_master (vendor_id, vendor_name, full_address, gstin,
                                           contact_persons, status, is_demo)
               VALUES ($1,$2,$3,$4,$5,$6,false)`,
              [d.vendor_id, d.vendor_name, d.full_address, d.gstin,
               JSON.stringify(d.contact_persons), d.status]
            );
            inserted += 1;
          }
        } else if (type === 'opening_stock') {
          // Controlled stock transaction: move the opening balance to the imported
          // target with a compensating delta so the ledger stays append-only.
          const { rows: current } = await client.query(
            `SELECT COALESCE(SUM(qty),0) AS qty FROM stock_movements
              WHERE item_id = $1 AND movement_type = 'opening'`,
            [d.item_id]
          );
          const delta = Number(d.qty) - Number(current[0].qty);
          if (Math.abs(delta) > 0.0005) {
            await client.query(
              `INSERT INTO stock_movements (item_id, qty, unit, movement_type, ref_type, ref_no,
                                            notes, created_by)
               VALUES ($1,$2,$3,'opening','import',$4,$5,$6)`,
              [d.item_id, delta, d.unit_of_item, 'OPENING-STOCK', d.remarks, req.actor.id]
            );
          }
          touchedItems.push(d.item_id);
          inserted += 1;
        }
      }

      if (touchedItems.length) await recomputeItemBalances(client, touchedItems);

      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'import',
        recordId: type,
        action: 'BULK_IMPORT',
        newValues: { type, mode, inserted, updated, skipped, rows: prepared.rows.length },
      });

      return { inserted, updated, skipped };
    });

    res.json({ ok: true, ...applied });
  })
);

export default router;
