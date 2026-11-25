/**
 * Five-stage anti-leakage material returns.
 *
 *   1 Return Raised   (site supervisor)
 *   2 Pickup Assigned (store exec / manager)
 *   3 Picked Up       (supervisor or store exec)
 *   4 Store Received  (store helper / exec, optional arrival photo)
 *   5 System Posted   (store manager: usable / scrap / short reconciliation)
 *
 * Returns share the challan header (doc_kind = 'RET') so the site ledger, audit
 * trail and numbering stay in one place. Nothing is ever hard-deleted.
 */
import crypto from 'node:crypto';
import { recomputeItemBalances } from './db.js';
import { notify, writeAudit } from './audit.js';
import { nextDocNumber } from './numbering.js';
import { bad, notFound, num, str, todayIso } from './util.js';
import { TRANSPORT_MODES, postMovement } from './operations.js';
import { userIdsForRoles } from './settings.js';

export const RETURN_FLOWS = ['Return Store', 'Return Vendor'];
export const RETURN_OPEN_STATUSES = ['Return Raised', 'Pickup Assigned', 'Picked Up', 'Store Received'];
export const SLA_HOURS = 48;

export const RETURN_LIST_SELECT = `c.id, c.challan_code, c.challan_date, c.status, c.flow_type,
  c.transport_mode, c.driver_delivery_person_name, c.driver_phone, c.vehicle_no,
  c.return_reason, c.delay_reason, c.header_remarks, c.short_missing_flagged, c.short_missing_remarks,
  c.signed_return_dc_photo_url, c.received_photo_url, c.sla_48h_breach_flag,
  c.return_raised_at, c.pickup_assigned_at, c.picked_up_at, c.store_received_at,
  c.system_posted_at, c.closed_at, c.created_by,
  s.site_project_id, s.client_project_name, v.vendor_name,
  COALESCE(SUM(cl.qty), 0) AS sent_qty,
  COALESCE(SUM(cl.received_usable_qty), 0) AS usable_qty,
  COALESCE(SUM(cl.received_scrap_qty), 0) AS scrap_qty,
  COALESCE(SUM(cl.short_missing_qty), 0) AS short_qty,
  count(cl.id)::int AS line_count,
  ROUND(EXTRACT(EPOCH FROM (COALESCE(c.system_posted_at, now()) - c.return_raised_at)) / 3600)::int AS hours_open`;

export async function listReturns(runner, { supervisorId = null, statuses = null, limit = 300 } = {}) {
  const params = [];
  const where = ["c.doc_kind = 'RET'"];
  if (supervisorId) {
    params.push(supervisorId);
    where.push(`s.assigned_supervisor_id = $${params.length}`);
  }
  if (statuses?.length) {
    params.push(statuses);
    where.push(`c.status = ANY($${params.length}::text[])`);
  }
  const { rows } = await runner.query(
    `SELECT ${RETURN_LIST_SELECT}
       FROM challans c
       LEFT JOIN sites_master s ON s.id = c.site_id
       LEFT JOIN vendors_master v ON v.id = c.vendor_id
       LEFT JOIN challan_lines cl ON cl.challan_id = c.id
      WHERE ${where.join(' AND ')}
      GROUP BY c.id, s.site_project_id, s.client_project_name, v.vendor_name
      ORDER BY c.return_raised_at DESC NULLS LAST, c.challan_code DESC
      LIMIT ${Number(limit) || 300}`,
    params
  );
  return rows;
}

export async function getReturn(runner, id) {
  const { rows } = await runner.query(
    `SELECT ${RETURN_LIST_SELECT}
       FROM challans c
       LEFT JOIN sites_master s ON s.id = c.site_id
       LEFT JOIN vendors_master v ON v.id = c.vendor_id
       LEFT JOIN challan_lines cl ON cl.challan_id = c.id
      WHERE c.doc_kind = 'RET' AND c.id = $1
      GROUP BY c.id, s.site_project_id, s.client_project_name, v.vendor_name`,
    [id]
  );
  if (!rows.length) throw notFound('Return not found.');
  const { rows: lines } = await runner.query(
    `SELECT cl.id, cl.line_no, cl.qty, cl.unit, cl.line_source, cl.serial_nos,
            cl.received_usable_qty, cl.received_scrap_qty, cl.short_missing_qty,
            cl.return_condition, cl.inspection_remarks,
            i.item_code, i.item_name, i.category
       FROM challan_lines cl JOIN items_master i ON i.id = cl.item_id
      WHERE cl.challan_id = $1 ORDER BY cl.line_no`,
    [id]
  );
  return { ...rows[0], lines };
}

async function assertSiteAssignment(client, req, siteId) {
  const { rows } = await client.query('SELECT * FROM sites_master WHERE id = $1', [siteId]);
  const site = rows[0];
  if (!site) throw bad('Choose a valid site.', { site_id: 'Invalid site' });
  if (req.user.role === 'supervisor' && site.assigned_supervisor_id !== req.user.id) {
    throw bad('You can only raise returns for your assigned sites.', { site_id: 'Not your site' });
  }
  return site;
}

/** Stage 1 — raise a return for a site (supervisor). */
export async function raiseReturn(client, req, body = {}) {
  const flow = RETURN_FLOWS.includes(body.flow_type) ? body.flow_type : 'Return Store';
  const siteId = str(body.site_id);
  if (!siteId) throw bad('Choose the site the material is returning from.', { site_id: 'Required' });
  const site = await assertSiteAssignment(client, req, siteId);

  const reason = str(body.reason ?? body.return_reason, { max: 1000 });
  if (!reason) throw bad('Give the reason for this return.', { reason: 'Required' });

  const vendorId = flow === 'Return Vendor' ? str(body.vendor_id) : null;
  if (flow === 'Return Vendor' && !vendorId) {
    throw bad('Choose the vendor this material returns to.', { vendor_id: 'Required' });
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw bad('Add at least one item to the return.', { lines: 'Required' });
  const ids = [...new Set(rawLines.map((l) => String(l?.item_id || '')).filter(Boolean))];
  const { rows: itemRows } = await client.query(
    'SELECT id, item_code, item_name, unit FROM items_master WHERE id = ANY($1::uuid[])',
    [ids]
  );
  const byId = new Map(itemRows.map((r) => [r.id, r]));
  const lines = rawLines.map((line, idx) => {
    const item = byId.get(String(line?.item_id || ''));
    if (!item) throw bad(`Line ${idx + 1}: choose a valid item.`, { lines: `Line ${idx + 1} item` });
    const qty = num(line?.qty, { field: `Line ${idx + 1} quantity`, min: 0.001 });
    if (!qty) throw bad(`Line ${idx + 1}: quantity is required.`, { lines: `Line ${idx + 1} quantity` });
    return { item, qty };
  });

  const challanCode = await nextDocNumber(client, 'RET', todayIso());
  const { rows } = await client.query(
    `INSERT INTO challans
       (challan_code, doc_kind, challan_date, site_id, vendor_id, flow_type, status,
        return_reason, header_remarks, site_share_link, source_department, created_by,
        return_raised_at, sla_48h_breach_flag)
     VALUES ($1,'RET',CURRENT_DATE,$2,$3,$4,'Return Raised',$5,$5,$6,'STR',$7, now(), false)
     RETURNING id`,
    [challanCode, siteId, vendorId, flow, reason, `sh_${crypto.randomBytes(9).toString('hex')}`, req.user.id]
  );
  const returnId = rows[0].id;

  let lineNo = 1;
  for (const line of lines) {
    await client.query(
      `INSERT INTO challan_lines (challan_id, line_no, item_id, qty, unit, line_source)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [returnId, lineNo, line.item.id, line.qty, line.item.unit, flow === 'Return Vendor' ? 'Vendor' : 'Store']
    );
    lineNo += 1;
  }

  const storeUsers = await userIdsForRoles(client, ['store_manager', 'store_exec', 'admin']);
  await notify(client, storeUsers, {
    type: 'return_raised',
    title: `${challanCode} raised by ${site.site_project_id}`,
    body: `${lines.length} line(s) · ${flow} · ${reason}`,
    link: '/returns',
    severity: 'warning',
  });

  await writeAudit(client, req, {
    module: 'Returns',
    recordType: 'challans',
    recordId: returnId,
    action: 'RETURN_RAISED',
    newValues: { challan_code: challanCode, flow_type: flow, site: site.site_project_id, reason, lines },
  });

  return { id: returnId, challan_code: challanCode, status: 'Return Raised' };
}

/** Stage 2 — assign transport + driver (store exec / manager). */
export async function assignPickup(client, req, id, body = {}) {
  const { rows } = await client.query('SELECT * FROM challans WHERE id = $1 AND doc_kind = $2 FOR UPDATE', [
    id,
    'RET',
  ]);
  const ret = rows[0];
  if (!ret) throw notFound('Return not found.');
  if (ret.status !== 'Return Raised') throw bad(`Pickup cannot be assigned while the return is ${ret.status}.`);

  const mode = TRANSPORT_MODES.includes(body.transport_mode) ? body.transport_mode : null;
  if (!mode) throw bad('Choose the transport mode.', { transport_mode: 'Required' });
  const driver = str(body.driver_delivery_person_name, { max: 160 });
  const phone = str(body.driver_phone, { max: 20 });
  const vehicle = str(body.vehicle_no, { max: 40 });
  if (!driver) throw bad('Driver / delivery person name is required.', { driver_delivery_person_name: 'Required' });
  if (!phone) throw bad('Driver phone is required.', { driver_phone: 'Required' });
  if (!vehicle) throw bad('Vehicle number is required.', { vehicle_no: 'Required' });

  await client.query(
    `UPDATE challans
        SET status = 'Pickup Assigned', pickup_assigned_at = now(), transport_mode = $2,
            driver_delivery_person_name = $3, driver_phone = $4, vehicle_no = $5
      WHERE id = $1`,
    [id, mode, driver, phone, vehicle]
  );

  const { rows: siteRows } = await client.query(
    'SELECT assigned_supervisor_id, site_project_id FROM sites_master WHERE id = $1',
    [ret.site_id]
  );
  await notify(client, [siteRows[0]?.assigned_supervisor_id], {
    type: 'return_pickup',
    title: `${ret.challan_code}: pickup assigned`,
    body: `${mode} · ${driver} · ${vehicle}. Hand the material over when the driver arrives.`,
    link: '/m/returns',
    severity: 'info',
  });

  await writeAudit(client, req, {
    module: 'Returns',
    recordType: 'challans',
    recordId: id,
    action: 'PICKUP_ASSIGNED',
    oldValues: { status: ret.status },
    newValues: { status: 'Pickup Assigned', transport_mode: mode, driver, phone, vehicle },
  });

  return { ok: true, status: 'Pickup Assigned' };
}

/** Stage 3 — material handed to the driver. */
export async function markHandover(client, req, id) {
  const { rows } = await client.query('SELECT * FROM challans WHERE id = $1 AND doc_kind = $2 FOR UPDATE', [
    id,
    'RET',
  ]);
  const ret = rows[0];
  if (!ret) throw notFound('Return not found.');
  if (ret.status !== 'Pickup Assigned') throw bad(`The return is ${ret.status}, not waiting for handover.`);

  if (req.user.role === 'supervisor') {
    const { rows: siteRows } = await client.query(
      'SELECT assigned_supervisor_id FROM sites_master WHERE id = $1',
      [ret.site_id]
    );
    if (siteRows[0]?.assigned_supervisor_id !== req.user.id) {
      throw bad('This return belongs to another site.', { site_id: 'Not your site' });
    }
  }

  await client.query(`UPDATE challans SET status = 'Picked Up', picked_up_at = now() WHERE id = $1`, [id]);

  const storeUsers = await userIdsForRoles(client, ['store_manager', 'store_exec', 'store_helper']);
  await notify(client, storeUsers, {
    type: 'return_picked_up',
    title: `${ret.challan_code} left the site`,
    body: 'Mark it received at the store when it reaches the gate.',
    link: '/returns',
    severity: 'info',
  });

  await writeAudit(client, req, {
    module: 'Returns',
    recordType: 'challans',
    recordId: id,
    action: 'RETURN_PICKED_UP',
    oldValues: { status: ret.status },
    newValues: { status: 'Picked Up' },
  });

  return { ok: true, status: 'Picked Up' };
}

/** Stage 4 — store receipt (helper one tap, optional arrival photo). */
export async function markReceived(client, req, id, body = {}) {
  const { rows } = await client.query('SELECT * FROM challans WHERE id = $1 AND doc_kind = $2 FOR UPDATE', [
    id,
    'RET',
  ]);
  const ret = rows[0];
  if (!ret) throw notFound('Return not found.');
  if (ret.status !== 'Picked Up') throw bad(`The return is ${ret.status}, not in transit.`);

  const photo = str(body.photo_url, { max: 500 });
  await client.query(
    `UPDATE challans
        SET status = 'Store Received', store_received_at = now(), received_photo_url = COALESCE($2, received_photo_url)
      WHERE id = $1`,
    [id, photo]
  );

  const managers = await userIdsForRoles(client, ['store_manager', 'admin']);
  await notify(client, managers, {
    type: 'return_received',
    title: `${ret.challan_code} received at store`,
    body: 'Inspect the lines and post usable / scrap / short quantities.',
    link: '/returns',
    severity: 'warning',
  });

  await writeAudit(client, req, {
    module: 'Returns',
    recordType: 'challans',
    recordId: id,
    action: 'STORE_RECEIVED',
    oldValues: { status: ret.status },
    newValues: { status: 'Store Received', photo_url: photo },
  });

  return { ok: true, status: 'Store Received' };
}

/** Attach the signed return DC (required to close a vendor return). */
export async function attachSignedReturnDc(client, req, id, body = {}) {
  const photo = str(body.photo_url, { max: 500 });
  if (!photo) throw bad('Upload the signed return DC photo first.', { photo_url: 'Required' });
  const { rows } = await client.query(
    `UPDATE challans SET signed_return_dc_photo_url = $2 WHERE id = $1 AND doc_kind = 'RET' RETURNING id, challan_code`,
    [id, photo]
  );
  if (!rows.length) throw notFound('Return not found.');
  await writeAudit(client, req, {
    module: 'Returns',
    recordType: 'challans',
    recordId: id,
    action: 'SIGNED_RETURN_DC_UPLOADED',
    newValues: { photo_url: photo },
  });
  return { ok: true, url: photo };
}

const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

/**
 * Stage 5 — line-by-line inspection and posting.
 * Sent_Qty must equal Usable + Scrap + Short/Missing on every line.
 */
export async function postReturn(client, req, id, body = {}) {
  const { rows } = await client.query('SELECT * FROM challans WHERE id = $1 AND doc_kind = $2 FOR UPDATE', [
    id,
    'RET',
  ]);
  const ret = rows[0];
  if (!ret) throw notFound('Return not found.');
  if (ret.status !== 'Store Received') {
    throw bad(`Only a store-received return can be posted (this one is ${ret.status}).`, { status: ret.status });
  }

  // Overdue (>48h) returns must carry a delay reason from the store side.
  const hoursOpen = (Date.now() - new Date(ret.return_raised_at).getTime()) / 3600000;
  const delayReason = str(body.delay_reason ?? ret.delay_reason, { max: 1000 });
  if (hoursOpen > SLA_HOURS && !delayReason) {
    throw bad('This return is past 48 hours — record the delay reason before posting.', {
      delay_reason: 'Required after 48h',
    });
  }

  const signedReturnDc = str(body.signed_return_dc_photo_url) || ret.signed_return_dc_photo_url;
  if (ret.flow_type === 'Return Vendor' && !signedReturnDc) {
    throw bad('Upload the signed return DC before closing a vendor return.', {
      signed_return_dc_photo_url: 'Required for vendor returns',
    });
  }

  const { rows: lineRows } = await client.query(
    'SELECT * FROM challan_lines WHERE challan_id = $1 ORDER BY line_no FOR UPDATE',
    [id]
  );
  const submitted = new Map((Array.isArray(body.lines) ? body.lines : []).map((l) => [String(l.id), l]));

  let usableTotal = 0;
  let scrapTotal = 0;
  let shortTotal = 0;
  const saved = [];

  for (const line of lineRows) {
    const input = submitted.get(line.id);
    if (!input) throw bad(`Line ${line.line_no}: enter the inspected quantities.`, { lines: `Line ${line.line_no} missing` });
    const usable = round3(num(input.usable, { field: `Line ${line.line_no} usable`, min: 0, def: 0 }) || 0);
    const scrap = round3(num(input.scrap, { field: `Line ${line.line_no} scrap`, min: 0, def: 0 }) || 0);
    const short = round3(num(input.short, { field: `Line ${line.line_no} short/missing`, min: 0, def: 0 }) || 0);
    const remarks = str(input.remarks, { max: 500 });
    const sent = Number(line.qty);

    if (Math.abs(usable + scrap + short - sent) > 0.0005) {
      throw bad(
        `Line ${line.line_no}: usable + scrap + short must equal the sent quantity (${sent} ${line.unit}).`,
        { lines: `Line ${line.line_no} does not reconcile` }
      );
    }
    if (scrap > 0 && !remarks) {
      throw bad(`Line ${line.line_no}: remarks are mandatory for scrap quantity.`, {
        lines: `Line ${line.line_no} scrap remarks`,
      });
    }
    if (short > 0 && !remarks) {
      throw bad(`Line ${line.line_no}: remarks are mandatory when material is short or missing.`, {
        lines: `Line ${line.line_no} short remarks`,
      });
    }

    await client.query(
      `UPDATE challan_lines
          SET received_usable_qty = $2, received_scrap_qty = $3, short_missing_qty = $4,
              return_condition = $5, inspection_remarks = $6
        WHERE id = $1`,
      [line.id, usable, scrap, short, scrap > 0 && usable === 0 ? 'Scrap' : 'Usable', remarks]
    );

    if (usable > 0) {
      await postMovement(client, {
        itemId: line.item_id,
        qty: usable,
        unit: line.unit,
        movementType: 'return_usable',
        refType: 'challan',
        refId: id,
        refNo: ret.challan_code,
        notes: `Return ${ret.flow_type} usable quantity`,
        createdBy: req.user.id,
      });
    }
    if (scrap > 0) {
      await postMovement(client, {
        itemId: line.item_id,
        qty: 0,
        scrap,
        unit: line.unit,
        movementType: 'return_scrap',
        refType: 'challan',
        refId: id,
        refNo: ret.challan_code,
        notes: remarks || 'Scrap received on return',
        createdBy: req.user.id,
      });
    }

    usableTotal += usable;
    scrapTotal += scrap;
    shortTotal += short;
    saved.push({ line_id: line.id, item_id: line.item_id, sent, usable, scrap, short, remarks });
  }

  const flagged = shortTotal > 0;
  const shortRemarks = flagged
    ? saved
        .filter((l) => l.short > 0)
        .map((l) => `${l.short} short — ${l.remarks}`)
        .join('; ')
    : null;

  await client.query(
    `UPDATE challans
        SET status = 'Closed', system_posted_at = now(), closed_at = now(),
            short_missing_flagged = $2, short_missing_remarks = $3,
            delay_reason = COALESCE($4, delay_reason),
            signed_return_dc_photo_url = COALESCE($5, signed_return_dc_photo_url)
      WHERE id = $1`,
    [id, flagged, shortRemarks, delayReason, signedReturnDc]
  );

  await recomputeItemBalances(client, lineRows.map((l) => l.item_id));

  await writeAudit(client, req, {
    module: 'Returns',
    recordType: 'challans',
    recordId: id,
    action: 'RETURN_POSTED',
    newValues: {
      status: 'Closed',
      usable: usableTotal,
      scrap: scrapTotal,
      short: shortTotal,
      delay_reason: delayReason,
      lines: saved,
    },
    remarks: flagged ? shortRemarks : delayReason,
  });

  if (flagged) {
    const owners = await userIdsForRoles(client, ['owner', 'admin']);
    await notify(client, owners, {
      type: 'short_missing',
      title: `${ret.challan_code}: short / missing material flagged`,
      body: shortRemarks,
      link: '/dashboards',
      severity: 'critical',
    });
    await writeAudit(client, req, {
      module: 'Returns',
      recordType: 'challans',
      recordId: id,
      action: 'SHORT_MISSING_FLAG',
      remarks: shortRemarks,
      newValues: saved.filter((l) => l.short > 0),
    });
  }

  if (ret.site_id) {
    const { rows: siteRows } = await client.query(
      'SELECT assigned_supervisor_id FROM sites_master WHERE id = $1',
      [ret.site_id]
    );
    await notify(client, [siteRows[0]?.assigned_supervisor_id], {
      type: 'return_closed',
      title: `${ret.challan_code} closed`,
      body: `Usable ${usableTotal} · Scrap ${scrapTotal} · Short ${shortTotal}.`,
      link: '/m/returns',
      severity: flagged ? 'critical' : 'info',
    });
  }

  return {
    ok: true,
    status: 'Closed',
    usable: usableTotal,
    scrap: scrapTotal,
    short: shortTotal,
    flagged,
  };
}
