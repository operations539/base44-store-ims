import { Router } from 'express';
import { query, recomputeItemBalances, tx } from '../db.js';
import { requirePermission } from '../rbac.js';
import { bad, dateOr, notFound, num, str, todayIso, wrap } from '../util.js';
import { nextDocNumber } from '../numbering.js';
import { writeAudit } from '../audit.js';
import { postMovement } from '../operations.js';

const router = Router();

const PURCHASE_SELECT = `pe.id, pe.purchase_id, pe.entry_date, pe.linked_po_id, pe.vendor_id,
  pe.item_id, pe.qty, pe.high_side_serial_nos, pe.bill_status, pe.bill_no, pe.rate,
  pe.tax_percent, pe.total_amount, pe.bill_photo_url, pe.created_by, pe.created_at,
  p.po_code, v.vendor_name, i.item_code, i.item_name, i.model_no, i.unit, i.category`;

function totalOf(qty, rate, taxPercent) {
  return Math.round(Number(qty || 0) * Number(rate || 0) * (1 + Number(taxPercent || 0) / 100) * 100) / 100;
}

// ------------------------- list -------------------------
router.get(
  '/purchasing',
  requirePermission('purchase.read'),
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.po) {
      params.push(String(req.query.po));
      where.push(`pe.linked_po_id = $${params.length}`);
    }
    if (req.query.bill_status) {
      params.push(String(req.query.bill_status));
      where.push(`pe.bill_status = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(lower(pe.purchase_id) LIKE $${params.length}
                   OR lower(COALESCE(pe.bill_no, '')) LIKE $${params.length}
                   OR lower(COALESCE(p.po_code, '')) LIKE $${params.length}
                   OR lower(i.item_name) LIKE $${params.length})`);
    }

    const { rows } = await query(
      `SELECT ${PURCHASE_SELECT}
         FROM purchasing_entries pe
         LEFT JOIN direct_pos p ON p.id = pe.linked_po_id
         JOIN vendors_master v ON v.id = pe.vendor_id
         JOIN items_master i ON i.id = pe.item_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY pe.entry_date DESC, pe.purchase_id DESC
        LIMIT 300`,
      params
    );
    res.json({ entries: rows });
  })
);

// ------------------------- create -------------------------
router.post(
  '/purchasing',
  requirePermission('purchase.create'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const entryDate = dateOr(body.entry_date, todayIso());
    const linkedPoId = str(body.linked_po_id);
    if (!linkedPoId) throw bad('Choose the Direct PO this receipt belongs to.', { linked_po_id: 'Required' });

    const created = await tx(async (client) => {
      const { rows: poRows } = await client.query(
        'SELECT id, po_code, vendor_id, line_items FROM direct_pos WHERE id = $1',
        [linkedPoId]
      );
      const po = poRows[0];
      if (!po) throw bad('Direct PO not found.', { linked_po_id: 'Invalid PO' });

      const itemId = str(body.item_id);
      if (!itemId) throw bad('Choose the item received.', { item_id: 'Required' });
      const { rows: itemRows } = await client.query(
        'SELECT id, item_code, item_name, unit, tax_percent, category FROM items_master WHERE id = $1',
        [itemId]
      );
      const item = itemRows[0];
      if (!item) throw bad('Choose a valid item.', { item_id: 'Invalid item' });

      const poLines = Array.isArray(po.line_items) ? po.line_items : [];
      const poLine = poLines.find((l) => String(l.item_id) === String(item.id));
      if (!poLine) {
        throw bad('That item is not on the linked purchase order.', { item_id: 'Not on PO' });
      }

      const qty = num(body.qty, { field: 'Received quantity', min: 0.001 });
      if (!qty) throw bad('Received quantity is required.', { qty: 'Required' });
      // Rate 0 is allowed while the vendor bill is pending.
      const rate = num(body.rate, { field: 'Rate', min: 0, def: 0 }) ?? 0;
      const taxPercent = num(body.tax_percent, { field: 'Tax %', min: 0, max: 100, def: Number(item.tax_percent || 0) });
      const billStatus = body.bill_status === 'Received' ? 'Received' : 'Pending';
      const billNo = str(body.bill_no, { max: 80 });
      const serials = Array.isArray(body.high_side_serial_nos)
        ? body.high_side_serial_nos.map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
        : [];

      const purchaseId = await nextDocNumber(client, 'PUR', entryDate);
      const { rows } = await client.query(
        `INSERT INTO purchasing_entries
           (purchase_id, entry_date, linked_po_id, vendor_id, item_id, qty, high_side_serial_nos,
            bill_status, bill_no, rate, tax_percent, total_amount, bill_photo_url, created_by, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false)
         RETURNING id`,
        [
          purchaseId,
          entryDate,
          po.id,
          po.vendor_id,
          item.id,
          qty,
          JSON.stringify(serials),
          billStatus,
          billNo,
          rate,
          taxPercent,
          totalOf(qty, rate, taxPercent),
          str(body.bill_photo_url, { max: 500 }),
          req.user.id,
        ]
      );
      const entryId = rows[0].id;

      await postMovement(client, {
        itemId: item.id,
        qty: Math.abs(qty),
        unit: item.unit,
        movementType: 'purchase',
        refType: 'purchase',
        refId: entryId,
        refNo: purchaseId,
        notes: `Goods received against ${po.po_code}`,
        createdBy: req.user.id,
      });
      await recomputeItemBalances(client, [item.id]);

      const { rows: balanceRows } = await client.query(
        'SELECT store_physical_stock FROM items_master WHERE id = $1',
        [item.id]
      );

      await writeAudit(client, req, {
        module: 'Purchasing',
        recordType: 'purchasing_entries',
        recordId: entryId,
        action: 'CREATE_PURCHASE',
        newValues: {
          purchase_id: purchaseId,
          po_code: po.po_code,
          item: item.item_code,
          qty,
          rate,
          bill_status: billStatus,
        },
      });

      return {
        id: entryId,
        purchase_id: purchaseId,
        balance_after: Number(balanceRows[0]?.store_physical_stock || 0),
      };
    });

    res.status(201).json(created);
  })
);

// ------------------------- edit bill details later -------------------------
router.patch(
  '/purchasing/:id',
  requirePermission('purchase.create'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const { rows: found } = await query('SELECT * FROM purchasing_entries WHERE id = $1', [req.params.id]);
    const existing = found[0];
    if (!existing) throw notFound('Purchasing entry not found.');

    const rate = body.rate !== undefined ? num(body.rate, { field: 'Rate', min: 0, def: 0 }) : existing.rate;
    const taxPercent =
      body.tax_percent !== undefined
        ? num(body.tax_percent, { field: 'Tax %', min: 0, max: 100, def: existing.tax_percent })
        : existing.tax_percent;
    const billStatus = body.bill_status !== undefined
      ? body.bill_status === 'Received'
        ? 'Received'
        : 'Pending'
      : existing.bill_status;

    const updated = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE purchasing_entries
            SET bill_no = $2, rate = $3, tax_percent = $4, bill_status = $5,
                total_amount = $6, bill_photo_url = $7, high_side_serial_nos = $8
          WHERE id = $1
          RETURNING *`,
        [
          req.params.id,
          body.bill_no !== undefined ? str(body.bill_no, { max: 80 }) : existing.bill_no,
          rate,
          taxPercent,
          billStatus,
          totalOf(existing.qty, rate, taxPercent),
          body.bill_photo_url !== undefined
            ? str(body.bill_photo_url, { max: 500 })
            : existing.bill_photo_url,
          body.high_side_serial_nos !== undefined
            ? JSON.stringify(
                Array.isArray(body.high_side_serial_nos)
                  ? body.high_side_serial_nos.map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
                  : []
              )
            : JSON.stringify(existing.high_side_serial_nos || []),
        ]
      );

      await writeAudit(client, req, {
        module: 'Purchasing',
        recordType: 'purchasing_entries',
        recordId: req.params.id,
        action: 'UPDATE_PURCHASE_BILL',
        oldValues: {
          bill_no: existing.bill_no,
          rate: existing.rate,
          bill_status: existing.bill_status,
          total_amount: existing.total_amount,
        },
        newValues: {
          bill_no: rows[0].bill_no,
          rate: rows[0].rate,
          bill_status: rows[0].bill_status,
          total_amount: rows[0].total_amount,
        },
      });

      return rows[0];
    });

    res.json({ entry: updated });
  })
);

export default router;
