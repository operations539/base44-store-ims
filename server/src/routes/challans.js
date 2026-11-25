import { Router } from 'express';
import crypto from 'node:crypto';
import { query, tx } from '../db.js';
import { requirePermission } from '../rbac.js';
import { bad, bool, dateOr, notFound, num, str, todayIso, wrap } from '../util.js';
import { nextDocNumber } from '../numbering.js';
import { notify, writeAudit } from '../audit.js';
import { DC_FLOWS, TRANSPORT_MODES, applyStoreIssue, refreshMrnStatus } from '../operations.js';

const router = Router();

const CHALLAN_SELECT = `c.id, c.challan_code, c.challan_date, c.doc_kind, c.backdated_flag,
  c.linked_mrn_id, c.linked_po_id, c.site_id, c.vendor_id, c.flow_type, c.vendor_physical_dc_no,
  c.transport_mode, c.driver_delivery_person_name, c.driver_phone, c.vehicle_no, c.header_remarks,
  c.status, c.signed_dc_photo_url, c.override_minus_stock_flag, c.created_by, c.created_at,
  s.site_project_id, s.client_project_name, s.full_site_address,
  m.mrn_no, p.po_code, v.vendor_name, v.vendor_id AS vendor_code, v.full_address AS vendor_address,
  v.gstin AS vendor_gstin`;

async function buildLines(client, rawLines, flow) {
  if (!Array.isArray(rawLines) || !rawLines.length) {
    throw bad('Add at least one item to the challan.', { lines: 'Required' });
  }
  const ids = [...new Set(rawLines.map((l) => String(l?.item_id || '')).filter(Boolean))];
  if (!ids.length) throw bad('Choose an item on every line.', { lines: 'Required' });

  const { rows } = await client.query(
    'SELECT id, item_code, item_name, model_no, unit FROM items_master WHERE id = ANY($1::uuid[])',
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  return rawLines.map((line, idx) => {
    const item = byId.get(String(line?.item_id || ''));
    if (!item) throw bad(`Line ${idx + 1}: choose a valid item.`, { lines: `Line ${idx + 1} item` });
    const qty = num(line?.qty, { field: `Line ${idx + 1} quantity`, min: 0.001 });
    if (!qty) throw bad(`Line ${idx + 1}: quantity is required.`, { lines: `Line ${idx + 1} quantity` });
    const lineSource = line?.line_source === 'Vendor' ? 'Vendor' : 'Store';
    return {
      item_id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      model_no: item.model_no,
      unit: item.unit,
      qty,
      line_source: lineSource,
      serial_nos: Array.isArray(line?.serial_nos)
        ? line.serial_nos.map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
        : [],
    };
  }).map((line) => {
    if (flow === 'Full Store' && line.line_source === 'Vendor') {
      throw bad('A Full Store challan can only carry store-sourced lines.', { lines: 'Vendor line not allowed' });
    }
    if (flow === 'Direct Vendor' && line.line_source === 'Store') {
      throw bad('A Direct-to-Site challan carries vendor lines only.', { lines: 'Store line not allowed' });
    }
    return line;
  });
}

// ------------------------- list -------------------------
router.get(
  '/challans',
  requirePermission('challan.read'),
  wrap(async (req, res) => {
    const params = [];
    const where = ["c.doc_kind = 'DC'"];
    if (req.query.flow) {
      params.push(String(req.query.flow));
      where.push(`c.flow_type = $${params.length}`);
    }
    if (req.query.site_id) {
      params.push(String(req.query.site_id));
      where.push(`c.site_id = $${params.length}`);
    }
    if (req.query.mrn) {
      params.push(String(req.query.mrn));
      where.push(`c.linked_mrn_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(lower(c.challan_code) LIKE $${params.length}
                   OR lower(COALESCE(m.mrn_no, '')) LIKE $${params.length}
                   OR lower(s.site_project_id) LIKE $${params.length})`);
    }

    const { rows } = await query(
      `SELECT c.id, c.challan_code, c.challan_date, c.flow_type, c.status, c.transport_mode,
              c.driver_delivery_person_name, c.override_minus_stock_flag, c.backdated_flag,
              c.signed_dc_photo_url, c.linked_mrn_id, c.linked_po_id, c.vendor_physical_dc_no,
              m.mrn_no, p.po_code, v.vendor_name, s.site_project_id, s.client_project_name,
              COALESCE(SUM(cl.qty), 0) AS total_qty,
              count(cl.id)::int AS line_count
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN material_requests m ON m.id = c.linked_mrn_id
         LEFT JOIN direct_pos p ON p.id = c.linked_po_id
         LEFT JOIN vendors_master v ON v.id = c.vendor_id
         LEFT JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE ${where.join(' AND ')}
        GROUP BY c.id, m.mrn_no, p.po_code, v.vendor_name, s.site_project_id, s.client_project_name
        ORDER BY c.challan_date DESC, c.challan_code DESC
        LIMIT 300`,
      params
    );

    res.json({ challans: rows });
  })
);

// ------------------------- detail -------------------------
router.get(
  '/challans/:id',
  requirePermission('challan.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT ${CHALLAN_SELECT}
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN material_requests m ON m.id = c.linked_mrn_id
         LEFT JOIN direct_pos p ON p.id = c.linked_po_id
         LEFT JOIN vendors_master v ON v.id = c.vendor_id
        WHERE c.id = $1 AND c.doc_kind = 'DC'`,
      [req.params.id]
    );
    if (!rows.length) throw notFound('Challan not found.');

    const { rows: lines } = await query(
      `SELECT cl.id, cl.line_no, cl.qty, cl.unit, cl.line_source, cl.serial_nos,
              i.item_code, i.item_name, i.model_no, i.category
         FROM challan_lines cl JOIN items_master i ON i.id = cl.item_id
        WHERE cl.challan_id = $1 ORDER BY cl.line_no`,
      [req.params.id]
    );

    res.json({ challan: { ...rows[0], lines } });
  })
);

// ------------------------- create -------------------------
router.post(
  '/challans',
  requirePermission('challan.create'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const flow = DC_FLOWS.includes(body.flow_type) ? body.flow_type : null;
    if (!flow) throw bad('Choose the dispatch flow.', { flow_type: 'Required' });

    const siteId = str(body.site_id);
    if (!siteId) throw bad('Choose the delivery site.', { site_id: 'Required' });
    const challanDate = dateOr(body.challan_date, todayIso());
    const transportMode = TRANSPORT_MODES.includes(body.transport_mode) ? body.transport_mode : null;
    if (!transportMode) throw bad('Choose the transport mode.', { transport_mode: 'Required' });

    const linkedMrnId = str(body.linked_mrn_id);
    const linkedPoId = str(body.linked_po_id);

    const created = await tx(async (client) => {
      const { rows: siteRows } = await client.query('SELECT * FROM sites_master WHERE id = $1', [siteId]);
      const site = siteRows[0];
      if (!site) throw bad('Choose a valid site.', { site_id: 'Invalid site' });
      if (site.status !== 'Active') throw bad('That site is closed.', { site_id: 'Closed site' });

      if (linkedMrnId) {
        const { rows: mrnRows } = await client.query(
          'SELECT id, mrn_no, site_id, status FROM material_requests WHERE id = $1',
          [linkedMrnId]
        );
        const mrn = mrnRows[0];
        if (!mrn) throw bad('Linked MRN not found.', { linked_mrn_id: 'Invalid MRN' });
        if (!['Approved', 'Partial'].includes(mrn.status)) {
          throw bad('Approve the MRN before dispatching against it.', { linked_mrn_id: `MRN is ${mrn.status}` });
        }
        if (mrn.site_id !== siteId) {
          throw bad('The challan site must match the MRN site.', { site_id: 'Site mismatch' });
        }
      }

      let vendorId = str(body.vendor_id);
      if (linkedPoId) {
        const { rows: poRows } = await client.query(
          'SELECT id, po_code, vendor_id, status FROM direct_pos WHERE id = $1',
          [linkedPoId]
        );
        const po = poRows[0];
        if (!po) throw bad('Linked Direct PO not found.', { linked_po_id: 'Invalid PO' });
        if (po.status === 'Cancelled') throw bad('That purchase order is cancelled.', { linked_po_id: 'Cancelled PO' });
        if (!vendorId) vendorId = po.vendor_id;
      }

      const lines = await buildLines(client, body.lines, flow);
      const vendorLines = lines.filter((l) => l.line_source === 'Vendor');
      if (vendorLines.length && !linkedPoId) {
        throw bad('Vendor-sourced lines need a linked Direct PO.', { linked_po_id: 'Required for vendor lines' });
      }
      if (flow === 'Direct Vendor' && !linkedPoId) {
        throw bad('Direct-to-Site dispatch needs a linked Direct PO.', { linked_po_id: 'Required' });
      }

      const challanCode = await nextDocNumber(client, 'DC', challanDate);
      const backdated = bool(body.backdated_flag) || challanDate < todayIso();

      const { rows } = await client.query(
        `INSERT INTO challans
           (challan_code, doc_kind, challan_date, backdated_flag, linked_mrn_id, linked_po_id,
            site_id, vendor_id, flow_type, vendor_physical_dc_no, transport_mode,
            driver_delivery_person_name, driver_phone, vehicle_no, header_remarks, status,
            site_share_link, source_department, created_by, is_demo)
         VALUES ($1,'DC',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Issued',$15,'STR',$16,false)
         RETURNING id`,
        [
          challanCode,
          challanDate,
          backdated,
          linkedMrnId,
          linkedPoId,
          siteId,
          vendorId,
          flow,
          str(body.vendor_physical_dc_no, { max: 120 }),
          transportMode,
          str(body.driver_delivery_person_name, { max: 160 }),
          str(body.driver_phone, { max: 20 }),
          str(body.vehicle_no, { max: 40 }),
          str(body.header_remarks, { max: 1000 }),
          `sh_${crypto.randomBytes(9).toString('hex')}`,
          req.user.id,
        ]
      );
      const challanId = rows[0].id;

      let lineNo = 1;
      for (const line of lines) {
        await client.query(
          `INSERT INTO challan_lines
             (challan_id, line_no, item_id, qty, unit, line_source, serial_nos)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [challanId, lineNo, line.item_id, line.qty, line.unit, line.line_source, JSON.stringify(line.serial_nos)]
        );
        lineNo += 1;
      }

      // Atomic two-ledger posting: only Store lines move the store balance.
      const negatives = await applyStoreIssue(client, lines, {
        refId: challanId,
        refNo: challanCode,
        siteLabel: site.site_project_id,
        createdBy: req.user.id,
        flow,
      });

      if (negatives.length) {
        await client.query('UPDATE challans SET override_minus_stock_flag = true WHERE id = $1', [challanId]);
        await writeAudit(client, req, {
          module: 'Dispatch',
          recordType: 'challans',
          recordId: challanId,
          action: 'MINUS_STOCK_OVERRIDE',
          remarks: `${challanCode} issued with a negative store balance (non-blocking override)`,
          newValues: negatives,
        });
      }

      if (linkedMrnId) await refreshMrnStatus(client, linkedMrnId);

      await writeAudit(client, req, {
        module: 'Dispatch',
        recordType: 'challans',
        recordId: challanId,
        action: 'CREATE_CHALLAN',
        newValues: { challan_code: challanCode, flow_type: flow, site: site.site_project_id, lines },
      });

      if (site.assigned_supervisor_id) {
        await notify(client, [site.assigned_supervisor_id], {
          type: 'dispatch_created',
          title: `${challanCode} dispatched to your site`,
          body: `${flow} · ${lines.length} line(s) · ${transportMode}.`,
          link: '/m/tracking',
          severity: 'info',
        });
      }

      return {
        id: challanId,
        challan_code: challanCode,
        flow_type: flow,
        negative_items: negatives.map((n) => ({
          item_code: n.item_code,
          item_name: n.item_name,
          store_physical_stock: Number(n.store_physical_stock),
          unit: n.unit,
        })),
      };
    });

    res.status(201).json(created);
  })
);

export default router;
