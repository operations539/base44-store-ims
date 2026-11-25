/**
 * Shared operational helpers: MRN progress maths, the store-stock movement
 * writer and the derived site-material stage used by the tracking views.
 */
import { recomputeItemBalances } from './db.js';

export const MRN_PRIORITIES = ['Low', 'Normal', 'Urgent'];
export const MRN_ROUTINGS = ['Full Store', 'Split', 'Direct-to-Site'];
export const TRANSPORT_MODES = ['Internal EECO', 'Third-Party Porter', 'Vendor Direct', 'Field Staff'];
export const DC_FLOWS = ['Full Store', 'Split', 'Direct Vendor'];

/** Approved quantity for an MRN line — falls back to the requested qty. */
export function approvedQtyOf(line) {
  const raw = line?.approved_qty;
  if (raw === null || raw === undefined || raw === '') return Number(line?.qty || 0);
  return Number(raw);
}

/** Quantity already dispatched against an MRN, grouped by item. */
export async function dispatchedByItem(runner, mrnId) {
  const { rows } = await runner.query(
    `SELECT cl.item_id, SUM(cl.qty) AS qty
       FROM challans c
       JOIN challan_lines cl ON cl.challan_id = c.id
      WHERE c.linked_mrn_id = $1
        AND c.doc_kind = 'DC'
        AND c.status <> 'Cancelled'
      GROUP BY cl.item_id`,
    [mrnId]
  );
  return new Map(rows.map((r) => [r.item_id, Number(r.qty)]));
}

/**
 * Recompute the MRN status from the dispatch ledger:
 *   nothing dispatched -> Approved (or Pending)
 *   some dispatched    -> Partial
 *   all approved qty   -> Fulfilled
 * Rejected MRNs are never touched.
 */
export async function refreshMrnStatus(client, mrnId) {
  const { rows } = await client.query(
    'SELECT id, status, line_items FROM material_requests WHERE id = $1 FOR UPDATE',
    [mrnId]
  );
  const mrn = rows[0];
  if (!mrn || mrn.status === 'Rejected') return mrn?.status || null;

  const lines = Array.isArray(mrn.line_items) ? mrn.line_items : [];
  if (!lines.length) return mrn.status;

  const dispatched = await dispatchedByItem(client, mrnId);
  let anyDispatched = false;
  let allDispatched = true;

  for (const line of lines) {
    const need = approvedQtyOf(line);
    const got = dispatched.get(line.item_id) || 0;
    if (got > 0) anyDispatched = true;
    if (got + 0.0005 < need) allDispatched = false;
  }

  let next = mrn.status;
  if (allDispatched) next = 'Fulfilled';
  else if (anyDispatched) next = 'Partial';
  else next = mrn.status === 'Pending' ? 'Pending' : 'Approved';

  if (next !== mrn.status) {
    await client.query('UPDATE material_requests SET status = $2 WHERE id = $1', [mrnId, next]);
  }
  return next;
}

/** Derived supervisor-facing stage (Pending/Approved/Partial/Dispatched/Delivered/Returned). */
export function mrnStage(status, linkedChallans = []) {
  if (status === 'Rejected') return 'Rejected';
  if (status === 'Pending') return 'Pending';
  const dcs = linkedChallans.filter((c) => c.doc_kind === 'DC');
  const rets = linkedChallans.filter((c) => c.doc_kind === 'RET');
  if (rets.length) return 'Returned';
  if (status === 'Fulfilled') {
    const allSigned = dcs.length > 0 && dcs.every((c) => !!c.signed_dc_photo_url);
    return allSigned ? 'Delivered' : 'Dispatched';
  }
  return status;
}

/** Append one signed row to the immutable store-stock ledger. */
export async function postMovement(
  client,
  {
    itemId,
    qty,
    unit = null,
    movementType,
    refType = null,
    refId = null,
    refNo = null,
    notes = null,
    scrap = 0,
    createdBy = null,
    isDemo = false,
  }
) {
  await client.query(
    `INSERT INTO stock_movements
       (item_id, qty, scrap_qty_delta, unit, movement_type, ref_type, ref_id, ref_no,
        notes, created_by, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [itemId, qty, scrap, unit, movementType, refType, refId, refNo, notes, createdBy, isDemo]
  );
}

/** Recompute cached balances and return the items whose store balance went negative. */
export async function applyStoreIssue(client, lines, { refId, refNo, siteLabel, createdBy, flow }) {
  const storeLines = lines.filter((l) => l.line_source === 'Store');
  if (!storeLines.length) return [];

  const itemIds = [...new Set(storeLines.map((l) => l.item_id))];
  for (const line of storeLines) {
    await postMovement(client, {
      itemId: line.item_id,
      qty: -Math.abs(Number(line.qty)),
      unit: line.unit,
      movementType: 'challan_out',
      refType: 'challan',
      refId,
      refNo,
      notes: `${flow} dispatch to ${siteLabel}`,
      createdBy,
    });
  }
  await recomputeItemBalances(client, itemIds);

  const { rows } = await client.query(
    'SELECT id, item_code, item_name, unit, store_physical_stock FROM items_master WHERE id = ANY($1::uuid[])',
    [itemIds]
  );
  return rows.filter((r) => Number(r.store_physical_stock) < 0);
}

/** Direct PO totals, computed from the stored line items (never trusted from the client). */
export function poTotals(lineItems = []) {
  let taxable = 0;
  let tax = 0;
  for (const line of lineItems) {
    const amount = Number(line.qty || 0) * Number(line.unit_rate || 0);
    taxable += amount;
    tax += (amount * Number(line.tax_percent || 0)) / 100;
  }
  const round = (n) => Math.round(n * 100) / 100;
  return { taxable: round(taxable), tax: round(tax), total: round(taxable + tax) };
}
