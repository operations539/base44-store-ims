import { Router } from 'express';
import { query, tx } from '../db.js';
import { requirePermission } from '../rbac.js';
import { bad, bool, dateOr, denied, notFound, num, str, todayIso, wrap } from '../util.js';
import { nextDocNumber } from '../numbering.js';
import { notify, writeAudit } from '../audit.js';
import { poTotals } from '../operations.js';

const router = Router();

const DEFAULT_TERMS = [
  '1. Delivery to be made as per the schedule confirmed by Kool Mart India Pvt Ltd.',
  '2. Material must be strictly as per the approved make, model and specification.',
  '3. Invoice to be raised in the name of Kool Mart India Pvt Ltd with correct GSTIN.',
  '4. Payment terms: 30 days from receipt of material and acceptance of invoice.',
  '5. Any rejection on account of quality will be to the vendor account.',
  '6. This purchase order is subject to Mumbai jurisdiction only.',
].join('\n');

const PO_SELECT = `p.id, p.po_code, p.po_date, p.vendor_id, p.linked_mrn_id, p.delivery_location_type,
  p.delivery_site_id, p.auto_vendor_address, p.terms_conditions, p.approval_required,
  p.approver_ids, p.approval_status, p.approved_by, p.approved_at, p.approval_remarks,
  p.line_items, p.status, p.pdf_link, p.sent_via, p.sent_at, p.created_by, p.created_at,
  v.vendor_name, v.vendor_id AS vendor_code, v.full_address, v.gstin, v.contact_persons,
  s.site_project_id, s.client_project_name, m.mrn_no`;

async function termsFor(client) {
  const { rows } = await client.query("SELECT value FROM app_settings WHERE key = 'po_terms'");
  return rows[0]?.value?.terms || DEFAULT_TERMS;
}

async function buildPoLines(client, rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) {
    throw bad('Add at least one item to the purchase order.', { line_items: 'Required' });
  }
  const ids = [...new Set(rawLines.map((l) => String(l?.item_id || '')).filter(Boolean))];
  if (!ids.length) throw bad('Choose an item on every line.', { line_items: 'Required' });

  const { rows } = await client.query(
    'SELECT id, item_code, item_name, model_no, unit, tax_percent FROM items_master WHERE id = ANY($1::uuid[])',
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  return rawLines.map((line, idx) => {
    const item = byId.get(String(line?.item_id || ''));
    if (!item) throw bad(`Line ${idx + 1}: choose a valid item.`, { line_items: `Line ${idx + 1} item` });
    const qty = num(line?.qty, { field: `Line ${idx + 1} quantity`, min: 0.001 });
    if (!qty) throw bad(`Line ${idx + 1}: quantity is required.`, { line_items: `Line ${idx + 1} quantity` });
    // Rate 0 is deliberately allowed — a PO is never blocked on pending billing.
    const unitRate = num(line?.unit_rate, { field: `Line ${idx + 1} rate`, min: 0, def: 0 });
    return {
      item_id: item.id,
      item_code: item.item_code,
      item_name: item.item_name,
      model_no: item.model_no,
      unit: item.unit,
      qty,
      unit_rate: unitRate ?? 0,
      tax_percent: Number(item.tax_percent || 0),
      remarks: str(line?.remarks, { max: 300 }),
    };
  });
}

function withTotals(row) {
  const totals = poTotals(Array.isArray(row.line_items) ? row.line_items : []);
  const contacts = Array.isArray(row.contact_persons) ? row.contact_persons : [];
  const phone = contacts.map((c) => c?.phone).find(Boolean) || null;
  return { ...row, totals, vendor_phone: phone };
}

// ------------------------- approver options -------------------------
router.get(
  '/pos/approvers',
  requirePermission('po.create'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT id, full_name, role FROM users
        WHERE is_active = true AND role IN ('owner','store_manager')
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, full_name`
    );
    res.json({ approvers: rows });
  })
);

// ------------------------- list -------------------------
router.get(
  '/pos',
  requirePermission('po.read'),
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.status) {
      params.push(String(req.query.status));
      where.push(`p.status = $${params.length}`);
    }
    if (req.query.mrn) {
      params.push(String(req.query.mrn));
      where.push(`p.linked_mrn_id = $${params.length}`);
    }
    if (req.query.vendor_id) {
      params.push(String(req.query.vendor_id));
      where.push(`p.vendor_id = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT ${PO_SELECT}
         FROM direct_pos p
         JOIN vendors_master v ON v.id = p.vendor_id
         LEFT JOIN sites_master s ON s.id = p.delivery_site_id
         LEFT JOIN material_requests m ON m.id = p.linked_mrn_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY p.po_date DESC, p.po_code DESC
        LIMIT 300`,
      params
    );

    res.json({ pos: rows.map(withTotals) });
  })
);

// ------------------------- detail -------------------------
router.get(
  '/pos/:id',
  requirePermission('po.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT ${PO_SELECT}
         FROM direct_pos p
         JOIN vendors_master v ON v.id = p.vendor_id
         LEFT JOIN sites_master s ON s.id = p.delivery_site_id
         LEFT JOIN material_requests m ON m.id = p.linked_mrn_id
        WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw notFound('Direct PO not found.');

    const po = withTotals(rows[0]);
    const approvers = po.approver_ids?.length
      ? await query('SELECT id, full_name, role FROM users WHERE id = ANY($1::uuid[])', [po.approver_ids])
      : { rows: [] };

    res.json({ po: { ...po, approvers: approvers.rows } });
  })
);

// ------------------------- create -------------------------
router.post(
  '/pos',
  requirePermission('po.create'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const poDate = dateOr(body.po_date, todayIso());
    const approvalRequired = bool(body.approval_required);
    const locationType = body.delivery_location_type === 'Site' ? 'Site' : 'Store';

    const created = await tx(async (client) => {
      const vendorId = str(body.vendor_id);
      if (!vendorId) throw bad('Choose a vendor.', { vendor_id: 'Required' });
      const { rows: vendorRows } = await client.query('SELECT * FROM vendors_master WHERE id = $1', [vendorId]);
      const vendor = vendorRows[0];
      if (!vendor) throw bad('Choose a valid vendor.', { vendor_id: 'Invalid vendor' });
      if (vendor.status !== 'Active') throw bad('That vendor is inactive.', { vendor_id: 'Inactive vendor' });

      const siteId = locationType === 'Site' ? str(body.delivery_site_id) : null;
      if (locationType === 'Site') {
        if (!siteId) throw bad('Choose the delivery site.', { delivery_site_id: 'Required' });
        const { rows: siteRows } = await client.query('SELECT id FROM sites_master WHERE id = $1', [siteId]);
        if (!siteRows.length) throw bad('Choose a valid delivery site.', { delivery_site_id: 'Invalid site' });
      }

      const linkedMrnId = str(body.linked_mrn_id);
      if (linkedMrnId) {
        const { rows: mrnRows } = await client.query('SELECT id FROM material_requests WHERE id = $1', [linkedMrnId]);
        if (!mrnRows.length) throw bad('Linked MRN not found.', { linked_mrn_id: 'Invalid MRN' });
      }

      const lines = await buildPoLines(client, body.line_items);

      let approverIds = [];
      if (approvalRequired) {
        approverIds = [...new Set((body.approver_ids || []).map((id) => String(id)).filter(Boolean))];
        if (!approverIds.length) throw bad('Select at least one approver.', { approver_ids: 'Required' });
        const { rows: people } = await client.query(
          'SELECT id, role FROM users WHERE id = ANY($1::uuid[]) AND is_active = true',
          [approverIds]
        );
        const valid = people.filter((p) => ['owner', 'store_manager', 'admin'].includes(p.role));
        if (valid.length !== approverIds.length) {
          throw bad('Approvers must be Owners & VP or a Store Manager.', { approver_ids: 'Invalid approver' });
        }
        approverIds = valid.map((p) => p.id);
      }

      const poCode = await nextDocNumber(client, 'PO', poDate);
      const status = approvalRequired ? 'Pending Approval' : 'Issued';
      const terms = await termsFor(client);

      const { rows } = await client.query(
        `INSERT INTO direct_pos
           (po_code, po_date, vendor_id, linked_mrn_id, delivery_location_type, delivery_site_id,
            auto_vendor_address, terms_conditions, approval_required, approver_ids, approval_status,
            line_items, status, source_department, created_by, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'STR',$14,false)
         RETURNING id`,
        [
          poCode,
          poDate,
          vendor.id,
          linkedMrnId,
          locationType,
          siteId,
          vendor.full_address,
          terms,
          approvalRequired,
          approverIds,
          approvalRequired ? 'Pending' : 'Not Required',
          JSON.stringify(lines),
          status,
          req.user.id,
        ]
      );
      const poId = rows[0].id;

      await writeAudit(client, req, {
        module: 'Direct PO',
        recordType: 'direct_pos',
        recordId: poId,
        action: 'CREATE_PO',
        newValues: { po_code: poCode, vendor: vendor.vendor_name, status, lines },
      });

      if (approvalRequired) {
        await notify(client, approverIds, {
          type: 'po_approval',
          title: `${poCode} needs your approval`,
          body: `${vendor.vendor_name} · ${lines.length} line(s). Approve or reject before it is sent.`,
          link: '/pos',
          severity: 'warning',
        });
      }

      return { id: poId, po_code: poCode, status };
    });

    res.status(201).json(created);
  })
);

// ------------------------- edit rates / mark sent -------------------------
router.patch(
  '/pos/:id',
  requirePermission('po.create'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const { rows: found } = await query('SELECT * FROM direct_pos WHERE id = $1', [req.params.id]);
    const existing = found[0];
    if (!existing) throw notFound('Direct PO not found.');
    if (['Cancelled', 'Closed'].includes(existing.status)) {
      throw bad('This purchase order can no longer be edited.', { status: 'Locked' });
    }

    const result = await tx(async (client) => {
      const updates = [];
      const params = [req.params.id];

      if (Array.isArray(body.line_items)) {
        const rates = new Map(
          body.line_items
            .filter((l) => l && l.item_id)
            .map((l) => [String(l.item_id), num(l.unit_rate, { field: 'Unit rate', min: 0, def: 0 }) ?? 0])
        );
        const current = Array.isArray(existing.line_items) ? existing.line_items : [];
        const nextLines = current.map((line) =>
          rates.has(String(line.item_id)) ? { ...line, unit_rate: rates.get(String(line.item_id)) } : line
        );
        params.push(JSON.stringify(nextLines));
        updates.push(`line_items = $${params.length}`);
      }

      if (body.sent_via && ['Email', 'WhatsApp'].includes(body.sent_via)) {
        params.push(body.sent_via);
        updates.push(`sent_via = $${params.length}`);
        updates.push('sent_at = now()');
        if (existing.status === 'Issued') updates.push("status = 'Sent'");
      }

      if (!updates.length) throw bad('Nothing to update.', {});

      const { rows } = await client.query(
        `UPDATE direct_pos SET ${updates.join(', ')} WHERE id = $1 RETURNING id, status, line_items, sent_via`,
        params
      );

      await writeAudit(client, req, {
        module: 'Direct PO',
        recordType: 'direct_pos',
        recordId: req.params.id,
        action: 'UPDATE_PO',
        oldValues: { line_items: existing.line_items, status: existing.status },
        newValues: { line_items: rows[0].line_items, status: rows[0].status, sent_via: rows[0].sent_via },
      });

      return rows[0];
    });

    res.json({ po: { ...result, totals: poTotals(result.line_items || []) } });
  })
);

// ------------------------- approve / reject -------------------------
router.post(
  '/pos/:id/decision',
  requirePermission('po.approve'),
  wrap(async (req, res) => {
    const decision = req.body?.decision === 'reject' ? 'reject' : 'approve';
    const remarks = str(req.body?.remarks, { max: 1000 });

    const result = await tx(async (client) => {
      const { rows } = await client.query('SELECT * FROM direct_pos WHERE id = $1 FOR UPDATE', [req.params.id]);
      const po = rows[0];
      if (!po) throw notFound('Direct PO not found.');
      if (po.status !== 'Pending Approval') {
        throw bad('This purchase order is not awaiting approval.', { status: 'Not pending' });
      }
      const allowed =
        (po.approver_ids || []).includes(req.user.id) ||
        ['owner', 'store_manager', 'admin'].includes(req.user.role);
      if (!allowed) throw denied('You are not an approver on this purchase order.');

      const status = decision === 'reject' ? 'Cancelled' : 'Issued';
      await client.query(
        `UPDATE direct_pos
            SET status = $2, approval_status = $3, approved_by = $4, approved_at = now(), approval_remarks = $5
          WHERE id = $1`,
        [po.id, status, decision === 'reject' ? 'Rejected' : 'Approved', req.user.id, remarks]
      );

      await writeAudit(client, req, {
        module: 'Direct PO',
        recordType: 'direct_pos',
        recordId: po.id,
        action: decision === 'reject' ? 'REJECT_PO' : 'APPROVE_PO',
        oldValues: { status: po.status, approval_status: po.approval_status },
        newValues: { status, approval_status: decision === 'reject' ? 'Rejected' : 'Approved' },
        remarks,
      });

      if (po.created_by) {
        await notify(client, [po.created_by], {
          type: decision === 'reject' ? 'po_rejected' : 'po_approved',
          title: `${po.po_code} ${decision === 'reject' ? 'was rejected' : 'is approved'}`,
          body: remarks || (decision === 'reject' ? 'The approver rejected this PO.' : 'You can now send it to the vendor.'),
          link: '/pos',
          severity: decision === 'reject' ? 'warning' : 'info',
        });
      }

      return { ok: true, status };
    });

    res.json(result);
  })
);

export default router;
