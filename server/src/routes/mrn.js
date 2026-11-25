import { Router } from 'express';
import { pool, query, tx } from '../db.js';
import { can, requirePermission } from '../rbac.js';
import { bad, dateOr, denied, notFound, num, str, todayIso, wrap } from '../util.js';
import { nextDocNumber } from '../numbering.js';
import { notify, writeAudit } from '../audit.js';
import {
  MRN_PRIORITIES,
  MRN_ROUTINGS,
  approvedQtyOf,
  dispatchedByItem,
  mrnStage,
} from '../operations.js';

const router = Router();

const MRN_SELECT = `m.id, m.mrn_no, m.mrn_date, m.site_id, m.requested_by, m.required_date,
  m.priority, m.status, m.routing_type, m.line_items, m.remarks, m.decision_remarks,
  m.decided_by, m.decided_at, m.created_at, m.is_demo,
  s.site_project_id, s.client_project_name, s.full_site_address, s.assigned_supervisor_id,
  u.full_name AS requested_by_name, d.full_name AS decided_by_name`;

/** Site access: supervisors only ever see their assigned sites. */
async function assertSiteAccess(siteId, user) {
  const { rows } = await query('SELECT * FROM sites_master WHERE id = $1', [siteId]);
  const site = rows[0];
  if (!site) throw notFound('Site not found.');
  if (user.role === 'supervisor' && site.assigned_supervisor_id !== user.id) {
    throw denied('That site is not assigned to you.');
  }
  return site;
}

async function buildLines(client, rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) {
    throw bad('Add at least one item to the request.', { line_items: 'Required' });
  }
  const ids = [...new Set(rawLines.map((l) => String(l?.item_id || '')).filter(Boolean))];
  if (!ids.length) throw bad('Choose an item on every line.', { line_items: 'Required' });

  const { rows } = await client.query(
    'SELECT id, item_code, item_name, unit FROM items_master WHERE id = ANY($1::uuid[])',
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  return rawLines.map((line, idx) => {
    const item = byId.get(String(line?.item_id || ''));
    if (!item) throw bad(`Line ${idx + 1}: choose a valid item.`, { line_items: `Line ${idx + 1} item` });
    const qty = num(line?.qty, { field: `Line ${idx + 1} quantity`, min: 0.001 });
    if (!qty) throw bad(`Line ${idx + 1}: quantity is required.`, { line_items: `Line ${idx + 1} quantity` });
    return {
      item_id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      unit: item.unit,
      qty,
      remarks: str(line?.remarks, { max: 300 }),
    };
  });
}

async function decorateMrns(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [challans, dispatched] = await Promise.all([
    query(
      `SELECT id, challan_code, doc_kind, status, signed_dc_photo_url, linked_mrn_id
         FROM challans WHERE linked_mrn_id = ANY($1::uuid[])`,
      [ids]
    ),
    query(
      `SELECT c.linked_mrn_id, SUM(cl.qty) AS qty
         FROM challans c JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE c.linked_mrn_id = ANY($1::uuid[]) AND c.doc_kind = 'DC' AND c.status <> 'Cancelled'
        GROUP BY c.linked_mrn_id`,
      [ids]
    ),
  ]);

  const docsByMrn = new Map();
  for (const doc of challans.rows) {
    if (!docsByMrn.has(doc.linked_mrn_id)) docsByMrn.set(doc.linked_mrn_id, []);
    docsByMrn.get(doc.linked_mrn_id).push(doc);
  }
  const dispatchedByMrn = new Map(dispatched.rows.map((r) => [r.linked_mrn_id, Number(r.qty)]));

  return rows.map((row) => {
    const lines = Array.isArray(row.line_items) ? row.line_items : [];
    const docs = docsByMrn.get(row.id) || [];
    return {
      ...row,
      line_count: lines.length,
      requested_qty: lines.reduce((sum, l) => sum + Number(l.qty || 0), 0),
      approved_qty: lines.reduce((sum, l) => sum + approvedQtyOf(l), 0),
      dispatched_qty: dispatchedByMrn.get(row.id) || 0,
      challan_count: docs.filter((d) => d.doc_kind === 'DC').length,
      stage: mrnStage(row.status, docs),
    };
  });
}

// ------------------------- dropdown options -------------------------
router.get(
  '/mrn/options',
  requirePermission('mrn.create'),
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `WHERE s.assigned_supervisor_id = $${params.length}`;
    }
    const [items, sites] = await Promise.all([
      query(
        `SELECT id, item_code, item_name, model_no, category, unit, store_physical_stock
           FROM items_master ORDER BY category DESC, item_name`
      ),
      query(
        `SELECT s.id, s.site_project_id, s.client_project_name, s.full_site_address
           FROM sites_master s ${scope ? `${scope} AND` : 'WHERE'} s.status = 'Active'
          ORDER BY s.site_project_id`,
        params
      ),
    ]);
    res.json({ items: items.rows, sites: sites.rows });
  })
);

// ------------------------- list / tracking -------------------------
router.get(
  '/mrn',
  requirePermission('mrn.read'),
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      where.push(`s.assigned_supervisor_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      where.push(`m.status = $${params.length}`);
    }
    if (req.query.site_id) {
      params.push(String(req.query.site_id));
      where.push(`m.site_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(lower(m.mrn_no) LIKE $${params.length}
                   OR lower(s.site_project_id) LIKE $${params.length}
                   OR lower(s.client_project_name) LIKE $${params.length})`);
    }

    const { rows } = await query(
      `SELECT ${MRN_SELECT}
         FROM material_requests m
         JOIN sites_master s ON s.id = m.site_id
         LEFT JOIN users u ON u.id = m.requested_by
         LEFT JOIN users d ON d.id = m.decided_by
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.mrn_date DESC, m.mrn_no DESC
        LIMIT 300`,
      params
    );

    const mrns = await decorateMrns(rows);
    res.json({
      mrns,
      pricingVisible: can(req.user.role, 'stock.price.read'),
      canApprove: can(req.user.role, 'mrn.approve'),
    });
  })
);

// ------------------------- raise MRN -------------------------
router.post(
  '/mrn',
  requirePermission('mrn.create'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const siteId = str(body.site_id);
    if (!siteId) throw bad('Choose the site the material is needed at.', { site_id: 'Required' });

    const site = await assertSiteAccess(siteId, req.user);
    if (site.status !== 'Active') throw bad('That site is closed.', { site_id: 'Closed site' });

    const priority = MRN_PRIORITIES.includes(body.priority) ? body.priority : 'Normal';
    const requiredDate = dateOr(body.required_date);
    const mrnDate = dateOr(body.mrn_date, todayIso());
    const remarks = str(body.remarks, { max: 1000 });

    const created = await tx(async (client) => {
      const lines = await buildLines(client, body.line_items);
      const mrnNo = await nextDocNumber(client, 'MRN', mrnDate);
      const { rows } = await client.query(
        `INSERT INTO material_requests
           (mrn_no, mrn_date, site_id, requested_by, required_date, priority, status,
            line_items, remarks, source_department, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,$8,'PRJ',false)
         RETURNING id`,
        [mrnNo, mrnDate, siteId, req.user.id, requiredDate, priority, JSON.stringify(lines), remarks]
      );
      const mrnId = rows[0].id;

      await writeAudit(client, req, {
        module: 'Material Requests',
        recordType: 'material_requests',
        recordId: mrnId,
        action: 'CREATE_MRN',
        newValues: { mrn_no: mrnNo, site_id: siteId, priority, required_date: requiredDate, lines },
      });

      const managers = await client.query(
        "SELECT id FROM users WHERE role IN ('store_manager','admin') AND is_active = true"
      );
      await notify(
        client,
        managers.rows.map((r) => r.id),
        {
          type: 'mrn_submitted',
          title: `New MRN ${mrnNo} awaiting approval`,
          body: `${req.user.full_name} raised ${lines.length} item(s) for ${site.site_project_id}.`,
          link: `/mrn/${mrnId}`,
          severity: priority === 'Urgent' ? 'warning' : 'info',
        }
      );

      return { id: mrnId, mrn_no: mrnNo };
    });

    res.status(201).json(created);
  })
);

// ------------------------- MRN detail -------------------------
router.get(
  '/mrn/:id',
  requirePermission('mrn.read'),
  wrap(async (req, res) => {
    const { rows } = await query(`SELECT ${MRN_SELECT} FROM material_requests m
        JOIN sites_master s ON s.id = m.site_id
        LEFT JOIN users u ON u.id = m.requested_by
        LEFT JOIN users d ON d.id = m.decided_by
       WHERE m.id = $1`, [req.params.id]);
    const mrn = rows[0];
    if (!mrn) throw notFound('MRN not found.');
    if (req.user.role === 'supervisor' && mrn.assigned_supervisor_id !== req.user.id) {
      throw denied('That request belongs to another site.');
    }

    const withPrice = can(req.user.role, 'stock.price.read');
    const lines = Array.isArray(mrn.line_items) ? mrn.line_items : [];
    const itemIds = lines.map((l) => l.item_id).filter(Boolean);

    const [dispatched, stock, pos, challans] = await Promise.all([
      dispatchedByItem(pool, mrn.id),
      withPrice || can(req.user.role, 'stock.read')
        ? query(
            'SELECT id, store_physical_stock, unit FROM items_master WHERE id = ANY($1::uuid[])',
            [itemIds.length ? itemIds : null]
          )
        : Promise.resolve({ rows: [] }),
      query(
        `SELECT p.id, p.po_code, p.po_date, p.status, p.approval_status, p.delivery_location_type,
                p.line_items, p.approval_required, v.vendor_name
           FROM direct_pos p JOIN vendors_master v ON v.id = p.vendor_id
          WHERE p.linked_mrn_id = $1 ORDER BY p.po_date DESC, p.po_code DESC`,
        [mrn.id]
      ),
      query(
        `SELECT c.id, c.challan_code, c.challan_date, c.doc_kind, c.flow_type, c.status,
                c.signed_dc_photo_url, COALESCE(SUM(cl.qty), 0) AS total_qty
           FROM challans c LEFT JOIN challan_lines cl ON cl.challan_id = c.id
          WHERE c.linked_mrn_id = $1
          GROUP BY c.id ORDER BY c.challan_date DESC, c.challan_code DESC`,
        [mrn.id]
      ),
    ]);

    const stockById = new Map(stock.rows.map((r) => [r.id, Number(r.store_physical_stock)]));
    const enriched = lines.map((line) => {
      const sent = dispatched.get(line.item_id) || 0;
      const approved = approvedQtyOf(line);
      return {
        ...line,
        approved_qty: approved,
        dispatched_qty: sent,
        remaining_qty: Math.max(0, Math.round((approved - sent) * 1000) / 1000),
        store_stock: stockById.has(line.item_id) ? stockById.get(line.item_id) : null,
      };
    });

    const linkedPos = pos.rows.map((row) => {
      if (withPrice) return row;
      const { line_items: _lines, ...rest } = row;
      return { ...rest, line_items: [] };
    });

    res.json({
      mrn: { ...mrn, lines: enriched },
      stage: mrnStage(mrn.status, challans.rows),
      linked_pos: linkedPos,
      linked_challans: challans.rows,
      pricingVisible: withPrice,
      canApprove: can(req.user.role, 'mrn.approve'),
    });
  })
);

// ------------------------- approve / reject -------------------------
router.post(
  '/mrn/:id/decision',
  requirePermission('mrn.approve'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const decision = body.decision === 'reject' ? 'reject' : 'approve';
    const routing = MRN_ROUTINGS.includes(body.routing_type) ? body.routing_type : null;
    const remarks = str(body.remarks, { max: 1000 });

    const result = await tx(async (client) => {
      const { rows } = await client.query('SELECT * FROM material_requests WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ]);
      const mrn = rows[0];
      if (!mrn) throw notFound('MRN not found.');
      if (mrn.status !== 'Pending') throw bad('This request has already been decided.', { status: 'Already decided' });

      const lines = Array.isArray(mrn.line_items) ? mrn.line_items : [];
      let status;
      let savedLines = lines;

      if (decision === 'reject') {
        status = 'Rejected';
        await client.query(
          `UPDATE material_requests
              SET status = 'Rejected', decision_remarks = $2, decided_by = $3, decided_at = now()
            WHERE id = $1`,
          [mrn.id, remarks, req.user.id]
        );
      } else {
        if (!routing) throw bad('Choose how this request should be routed.', { routing_type: 'Required' });
        const decisions = Array.isArray(body.line_items) ? body.line_items : [];
        const byItem = new Map(decisions.map((d) => [String(d.item_id), d]));

        savedLines = lines.map((line) => {
          const row = byItem.get(String(line.item_id));
          const requested = Number(line.qty || 0);
          const approved = row ? Number(row.approved_qty) : requested;
          if (!Number.isFinite(approved) || approved < 0) {
            throw bad('Approved quantity must be zero or more.', { line_items: 'Invalid quantity' });
          }
          return { ...line, approved_qty: Math.min(approved, requested) };
        });
        if (!savedLines.some((l) => approvedQtyOf(l) > 0)) {
          throw bad('Approve at least one line.', { line_items: 'Nothing approved' });
        }

        status = 'Approved';
        await client.query(
          `UPDATE material_requests
              SET status = 'Approved', routing_type = $2, line_items = $3, decision_remarks = $4,
                  decided_by = $5, decided_at = now()
            WHERE id = $1`,
          [mrn.id, routing, JSON.stringify(savedLines), remarks, req.user.id]
        );
      }

      await writeAudit(client, req, {
        module: 'Material Requests',
        recordType: 'material_requests',
        recordId: mrn.id,
        action: decision === 'reject' ? 'REJECT_MRN' : 'APPROVE_MRN',
        oldValues: { status: mrn.status, line_items: lines },
        newValues: { status, routing_type: routing, line_items: savedLines },
        remarks,
      });

      if (mrn.requested_by) {
        await notify(client, [mrn.requested_by], {
          type: decision === 'reject' ? 'mrn_rejected' : 'mrn_approved',
          title: `${mrn.mrn_no} ${decision === 'reject' ? 'was rejected' : 'is approved'}`,
          body:
            decision === 'reject'
              ? remarks || 'The store manager rejected this request.'
              : `Routing: ${routing}. Dispatch will follow shortly.`,
          link: '/m/requests',
          severity: decision === 'reject' ? 'warning' : 'info',
        });
      }

      return { ok: true, status, routing_type: routing };
    });

    res.json(result);
  })
);

export default router;
