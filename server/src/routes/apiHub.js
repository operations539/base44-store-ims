/**
 * Internal REST API hub (Bearer token, scoped + revocable).
 *
 * Tokens are created in Admin → API Integration Hub. Only the SHA-256 hash is
 * stored; every write is audit-logged against the key that made it.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, tx } from '../db.js';
import { bad, num, str, todayIso, wrap } from '../util.js';
import { nextDocNumber } from '../numbering.js';
import { writeAudit } from '../audit.js';
import { applyStoreIssue, refreshMrnStatus } from '../operations.js';

const router = Router();

// Pool runner for helpers that expect a client-like object.
const db = { query };

const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/stock', scope: 'stock.read', description: 'Live item stock with minus/min-qty flags.' },
  { method: 'GET', path: '/api/v1/mrns', scope: 'mrns.read', description: 'Material requests with status and routing.' },
  { method: 'POST', path: '/api/v1/mrns', scope: 'mrns.write', description: 'Raise an MRN (site, priority, line items).' },
  { method: 'GET', path: '/api/v1/dispatch', scope: 'dispatch.read', description: 'Delivery challans with signed-DC state.' },
  { method: 'POST', path: '/api/v1/dispatch', scope: 'dispatch.write', description: 'Create a store dispatch challan (atomic ledger posting).' },
  { method: 'GET', path: '/api/v1/masters/items', scope: 'masters.read', description: 'Items master.' },
  { method: 'PUT', path: '/api/v1/masters/items/:id', scope: 'masters.write', description: 'Update an item (name, min qty, latest rate).' },
  { method: 'GET', path: '/api/v1/masters/sites', scope: 'masters.read', description: 'Sites master.' },
  { method: 'GET', path: '/api/v1/masters/vendors', scope: 'masters.read', description: 'Vendors master.' },
];

/** Bearer authentication for the internal API. */
async function apiAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token.' });

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    `SELECT id, name, scopes, created_by, revoked_at FROM api_keys WHERE token_hash = $1`,
    [hash]
  );
  const key = rows[0];
  if (!key || key.revoked_at) return res.status(401).json({ error: 'Invalid or revoked API token.' });

  query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [key.id]).catch(() => {});
  req.apiKey = key;
  req.auditReq = {
    actor: { id: key.created_by, role: 'api' },
    emulated: false,
    ipAddress: req.ip,
  };
  return next();
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return res.status(403).json({ error: `This token lacks the ${scope} scope.` });
    }
    return next();
  };
}

router.use(apiAuth);

router.get('/docs', (req, res) => {
  res.json({
    name: 'KoolMart Store IMS internal API',
    version: 'v1',
    auth: 'Authorization: Bearer <token>',
    scopes: req.apiKey.scopes,
    erp_sync: { status: 'inactive', note: 'External ERP sync is reserved for Phase 2; hooks only.' },
    endpoints: ENDPOINTS,
  });
});

router.get(
  '/stock',
  requireScope('stock.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT item_code, item_name, category, unit, store_physical_stock, min_qty_alert, scrap_qty,
              (store_physical_stock < 0) AS minus_stock,
              (min_qty_alert > 0 AND store_physical_stock < min_qty_alert) AS below_min
         FROM items_master ORDER BY category DESC, item_code`
    );
    res.json({ items: rows });
  })
);

router.get(
  '/mrns',
  requireScope('mrns.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT m.mrn_no, m.mrn_date, m.status, m.routing_type, m.priority, m.line_items,
              s.site_project_id
         FROM material_requests m JOIN sites_master s ON s.id = m.site_id
        ORDER BY m.mrn_date DESC LIMIT 200`
    );
    res.json({ mrns: rows });
  })
);

router.post(
  '/mrns',
  requireScope('mrns.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const siteId = str(body.site_id);
    if (!siteId) throw bad('site_id is required.', { site_id: 'Required' });
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (!rawLines.length) throw bad('At least one line item is required.', { lines: 'Required' });

    const ids = [...new Set(rawLines.map((l) => String(l.item_id || '')).filter(Boolean))];
    const { rows: items } = await query(
      'SELECT id, item_code, item_name, unit FROM items_master WHERE id = ANY($1::uuid[])',
      [ids]
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    const lines = rawLines.map((line, idx) => {
      const item = byId.get(String(line.item_id));
      if (!item) throw bad(`Line ${idx + 1}: unknown item_id.`, { lines: `Line ${idx + 1}` });
      const qty = num(line.qty, { field: `Line ${idx + 1} qty`, min: 0.001 });
      return { item_id: item.id, item_code: item.item_code, item_name: item.item_name, unit: item.unit, qty };
    });

    const created = await tx(async (client) => {
      const mrnNo = await nextDocNumber(client, 'MRN', todayIso());
      const { rows } = await client.query(
        `INSERT INTO material_requests
           (mrn_no, site_id, requested_by, required_date, priority, line_items, source_department, external_ref_id)
         VALUES ($1,$2,$3,$4,$5,$6,'PRJ',$7) RETURNING id, mrn_no, status`,
        [
          mrnNo,
          siteId,
          req.apiKey.created_by,
          str(body.required_date, { max: 10 }),
          ['Low', 'Normal', 'Urgent'].includes(body.priority) ? body.priority : 'Normal',
          JSON.stringify(lines),
          str(body.external_ref_id, { max: 120 }),
        ]
      );
      await writeAudit(client, req.auditReq, {
        module: 'API Hub',
        recordType: 'material_requests',
        recordId: rows[0].id,
        action: 'API_CREATE_MRN',
        newValues: { mrn_no: mrnNo, site_id: siteId, lines },
        remarks: `API key ${req.apiKey.name}`,
      });
      return rows[0];
    });

    res.status(201).json({ mrn: created });
  })
);

router.get(
  '/dispatch',
  requireScope('dispatch.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT c.challan_code, c.challan_date, c.flow_type, c.status, c.transport_mode,
              c.driver_delivery_person_name, c.vehicle_no, c.signed_dc_photo_url,
              c.sla_48h_breach_flag, s.site_project_id,
              COALESCE(SUM(cl.qty), 0) AS total_qty
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE c.doc_kind = 'DC'
        GROUP BY c.id, s.site_project_id
        ORDER BY c.challan_date DESC LIMIT 200`
    );
    res.json({ dispatch: rows });
  })
);

router.post(
  '/dispatch',
  requireScope('dispatch.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const siteId = str(body.site_id);
    if (!siteId) throw bad('site_id is required.', { site_id: 'Required' });
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (!rawLines.length) throw bad('At least one line item is required.', { lines: 'Required' });

    const ids = [...new Set(rawLines.map((l) => String(l.item_id || '')).filter(Boolean))];
    const { rows: items } = await query(
      'SELECT id, item_code, item_name, unit FROM items_master WHERE id = ANY($1::uuid[])',
      [ids]
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    const lines = rawLines.map((line, idx) => {
      const item = byId.get(String(line.item_id));
      if (!item) throw bad(`Line ${idx + 1}: unknown item_id.`, { lines: `Line ${idx + 1}` });
      const qty = num(line.qty, { field: `Line ${idx + 1} qty`, min: 0.001 });
      return { item_id: item.id, item_code: item.item_code, item_name: item.item_name, unit: item.unit, qty, line_source: 'Store' };
    });

    const created = await tx(async (client) => {
      const { rows: siteRows } = await client.query('SELECT * FROM sites_master WHERE id = $1', [siteId]);
      const site = siteRows[0];
      if (!site) throw bad('Unknown site_id.', { site_id: 'Invalid site' });

      const challanCode = await nextDocNumber(client, 'DC', todayIso());
      const { rows } = await client.query(
        `INSERT INTO challans
           (challan_code, doc_kind, challan_date, site_id, flow_type, transport_mode,
            driver_delivery_person_name, driver_phone, vehicle_no, status, site_share_link,
            source_department, external_ref_id, created_by)
         VALUES ($1,'DC',CURRENT_DATE,$2,'Full Store',$3,$4,$5,$6,'Issued',$7,'STR',$8,$9)
         RETURNING id, challan_code`,
        [
          challanCode,
          siteId,
          str(body.transport_mode, { max: 40 }) || 'Internal EECO',
          str(body.driver_delivery_person_name, { max: 160 }),
          str(body.driver_phone, { max: 20 }),
          str(body.vehicle_no, { max: 40 }),
          `sh_${crypto.randomBytes(9).toString('hex')}`,
          str(body.external_ref_id, { max: 120 }),
          req.apiKey.created_by,
        ]
      );
      const challanId = rows[0].id;

      let lineNo = 1;
      for (const line of lines) {
        await client.query(
          `INSERT INTO challan_lines (challan_id, line_no, item_id, qty, unit, line_source)
           VALUES ($1,$2,$3,$4,$5,'Store')`,
          [challanId, lineNo, line.item_id, line.qty, line.unit]
        );
        lineNo += 1;
      }

      const negatives = await applyStoreIssue(client, lines, {
        refId: challanId,
        refNo: challanCode,
        siteLabel: site.site_project_id,
        createdBy: req.apiKey.created_by,
        flow: 'Full Store',
      });
      if (negatives.length) {
        await client.query('UPDATE challans SET override_minus_stock_flag = true WHERE id = $1', [challanId]);
      }
      if (str(body.linked_mrn_id)) {
        await refreshMrnStatus(client, String(body.linked_mrn_id));
      }

      await writeAudit(client, req.auditReq, {
        module: 'API Hub',
        recordType: 'challans',
        recordId: challanId,
        action: 'API_CREATE_DISPATCH',
        newValues: { challan_code: challanCode, site: site.site_project_id, lines },
        remarks: `API key ${req.apiKey.name}`,
      });

      return { id: challanId, challan_code: challanCode, negative_items: negatives.length };
    });

    res.status(201).json(created);
  })
);

router.get(
  '/masters/items',
  requireScope('masters.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT id, item_code, item_name, category, prod_category, model_no, unit, tax_percent,
              min_qty_alert, store_physical_stock
         FROM items_master ORDER BY item_code`
    );
    res.json({ items: rows });
  })
);

router.put(
  '/masters/items/:id',
  requireScope('masters.write'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const { rows } = await query('SELECT * FROM items_master WHERE id = $1', [req.params.id]);
    const item = rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found.' });

    const next = {
      item_name: str(body.item_name, { max: 200 }) || item.item_name,
      min_qty_alert: num(body.min_qty_alert, { field: 'min_qty_alert', min: 0, def: Number(item.min_qty_alert) }),
      latest_rate: num(body.latest_rate, { field: 'latest_rate', min: 0, def: Number(item.latest_rate) }),
    };
    await query('UPDATE items_master SET item_name = $2, min_qty_alert = $3, latest_rate = $4 WHERE id = $1', [
      item.id,
      next.item_name,
      next.min_qty_alert,
      next.latest_rate,
    ]);
    await writeAudit(db, req.auditReq, {
      module: 'API Hub',
      recordType: 'items_master',
      recordId: item.id,
      action: 'API_UPDATE_ITEM',
      oldValues: { item_name: item.item_name, min_qty_alert: item.min_qty_alert, latest_rate: item.latest_rate },
      newValues: next,
      remarks: `API key ${req.apiKey.name}`,
    });
    res.json({ item: { id: item.id, item_code: item.item_code, ...next } });
  })
);

router.get(
  '/masters/sites',
  requireScope('masters.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, site_project_id, client_project_name, status FROM sites_master ORDER BY site_project_id'
    );
    res.json({ sites: rows });
  })
);

router.get(
  '/masters/vendors',
  requireScope('masters.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, vendor_id, vendor_name, gstin, status FROM vendors_master ORDER BY vendor_name'
    );
    res.json({ vendors: rows });
  })
);

export default router;
