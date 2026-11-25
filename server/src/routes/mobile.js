import { Router } from 'express';
import { query, tx } from '../db.js';
import { HttpError, bad, notFound, str, wrap } from '../util.js';
import { approvedQtyOf, mrnStage } from '../operations.js';
import { notify, writeAudit } from '../audit.js';
import { listReturns, markHandover, markReceived, raiseReturn } from '../returns.js';
import { userIdsForRoles } from '../settings.js';

/** Attach the derived tracking stage and dispatched quantity to MRN rows. */
async function decorateTracking(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [challans, dispatched] = await Promise.all([
    query(
      `SELECT id, doc_kind, status, signed_dc_photo_url, linked_mrn_id
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
    return {
      ...row,
      stage: mrnStage(row.status, docsByMrn.get(row.id) || []),
      requested_qty: lines.reduce((sum, l) => sum + Number(l.qty || 0), 0),
      approved_qty: lines.reduce((sum, l) => sum + approvedQtyOf(l), 0),
      dispatched_qty: dispatchedByMrn.get(row.id) || 0,
    };
  });
}

const router = Router();

function requireMobileRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'This screen is for field roles only.'));
    }
    return next();
  };
}

/** Helper: approved, price-free packing lists (outward challans not yet signed). */
router.get(
  '/packing',
  requireMobileRole(['store_helper', 'admin']),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.challan_code, c.challan_date, c.flow_type, c.status,
              c.signed_dc_photo_url, c.signed_dc_uploaded_at, c.sla_48h_breach_flag, c.transport_mode,
              c.driver_delivery_person_name, c.driver_phone, c.vehicle_no, c.site_share_link,
              s.site_project_id, s.client_project_name, s.full_site_address,
              COALESCE(SUM(cl.qty), 0) AS total_qty,
              count(cl.id)::int AS line_count
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE c.flow_type IN ('Full Store','Split','Direct Vendor')
          AND c.status IN ('Issued','Delivered-Signed')
        GROUP BY c.id, s.site_project_id, s.client_project_name, s.full_site_address
        ORDER BY c.challan_date DESC, c.challan_code DESC
        LIMIT 40`
    );

    const withLines = await Promise.all(
      rows.map(async (row) => {
        const lines = await query(
          `SELECT cl.line_no, cl.qty, cl.unit, cl.line_source, cl.serial_nos, i.item_code, i.item_name
             FROM challan_lines cl JOIN items_master i ON i.id = cl.item_id
            WHERE cl.challan_id = $1 ORDER BY cl.line_no`,
          [row.id]
        );
        return { ...row, lines: lines.rows };
      })
    );

    res.json({ challans: withLines });
  })
);

/** Supervisor: MRNs for assigned sites only. */
router.get(
  '/requests',
  requireMobileRole(['supervisor', 'admin']),
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `AND s.assigned_supervisor_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT m.id, m.mrn_no, m.mrn_date, m.required_date, m.priority, m.status,
              m.routing_type, m.line_items, s.site_project_id, s.client_project_name
         FROM material_requests m
         JOIN sites_master s ON s.id = m.site_id
        WHERE true ${scope}
        ORDER BY m.mrn_date DESC, m.mrn_no DESC
        LIMIT 50`,
      params
    );
    const decorated = await decorateTracking(rows);
    res.json({ requests: decorated });
  })
);

/** Supervisor: return requests; Helper: returns awaiting store receipt. */
router.get(
  '/returns',
  requireMobileRole(['supervisor', 'store_helper', 'admin']),
  wrap(async (req, res) => {
    const statuses =
      req.user.role === 'store_helper' ? ['Picked Up', 'Store Received'] : null;
    const rows = await listReturns({ query }, {
      supervisorId: req.user.role === 'supervisor' ? req.user.id : null,
      statuses,
      limit: 60,
    });
    res.json({ returns: rows });
  })
);

/** Supervisor: basic live tracking of their requests. */
router.get(
  '/tracking',
  requireMobileRole(['supervisor', 'admin']),
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `AND s.assigned_supervisor_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT m.id, m.mrn_no, m.mrn_date, m.status, m.routing_type, m.priority, m.line_items,
              s.site_project_id, s.client_project_name,
              (SELECT count(*)::int FROM challans c WHERE c.linked_mrn_id = m.id) AS challan_count,
              (SELECT count(*)::int FROM challans c WHERE c.linked_mrn_id = m.id
                 AND c.signed_dc_photo_url IS NOT NULL) AS signed_count
         FROM material_requests m
         JOIN sites_master s ON s.id = m.site_id
        WHERE true ${scope}
        ORDER BY m.mrn_date DESC LIMIT 50`,
      params
    );
    const decorated = await decorateTracking(rows);
    res.json({ tracking: decorated });
  })
);

/**
 * Helper: attach the signed delivery challan photo (1-tap camera upload).
 * Marks the challan Delivered-Signed and clears its 48-hour alert.
 */
router.post(
  '/signed-dc/:id',
  requireMobileRole(['store_helper', 'admin']),
  wrap(async (req, res) => {
    const photoUrl = str(req.body?.photo_url, { max: 500 });
    if (!photoUrl) throw bad('Upload the signed challan photo first.', { photo_url: 'Required' });

    const result = await tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, challan_code, status, site_id, signed_dc_photo_url
           FROM challans WHERE id = $1 AND doc_kind = 'DC' FOR UPDATE`,
        [req.params.id]
      );
      const challan = rows[0];
      if (!challan) throw notFound('Challan not found.');
      if (challan.status === 'Cancelled') throw bad('A cancelled challan cannot be signed off.');
      if (challan.signed_dc_photo_url) throw bad('A signed copy is already on file for this challan.');

      await client.query(
        `UPDATE challans
            SET signed_dc_photo_url = $2, status = 'Delivered-Signed',
                signed_dc_uploaded_at = now(), signed_dc_uploaded_by = $3,
                sla_48h_breach_flag = false
          WHERE id = $1`,
        [challan.id, photoUrl, req.user.id]
      );

      await writeAudit(client, req, {
        module: 'Dispatch',
        recordType: 'challans',
        recordId: challan.id,
        action: 'SIGNED_DC_UPLOADED',
        oldValues: { status: challan.status },
        newValues: { status: 'Delivered-Signed', photo_url: photoUrl },
      });

      const managers = await userIdsForRoles(client, ['store_manager', 'store_exec', 'admin']);
      await notify(client, managers, {
        type: 'signed_dc_received',
        title: `${challan.challan_code} signed copy received`,
        body: 'The signed DC is now in the site archive.',
        link: '/dashboards',
        severity: 'info',
      });

      return { ok: true, status: 'Delivered-Signed', photo_url: photoUrl };
    });

    res.json(result);
  })
);

/** Helper: site-wise signed DC gallery with role-controlled share links. */
router.get(
  '/dc-gallery',
  requireMobileRole(['store_helper', 'admin']),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.challan_code, c.challan_date, c.signed_dc_photo_url, c.signed_dc_uploaded_at,
              c.site_share_link, s.site_project_id, s.client_project_name,
              u.full_name AS uploaded_by_name
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN users u ON u.id = c.signed_dc_uploaded_by
        WHERE c.doc_kind = 'DC' AND c.signed_dc_photo_url IS NOT NULL
        ORDER BY s.site_project_id NULLS LAST, c.signed_dc_uploaded_at DESC NULLS LAST
        LIMIT 100`
    );
    const sites = [];
    const index = new Map();
    for (const row of rows) {
      const key = row.site_project_id || 'Unassigned';
      if (!index.has(key)) {
        const entry = {
          site_project_id: row.site_project_id,
          client_project_name: row.client_project_name,
          documents: [],
        };
        index.set(key, entry);
        sites.push(entry);
      }
      index.get(key).documents.push(row);
    }
    res.json({ sites });
  })
);

/** Supervisor: sites + issued material available to return. */
router.get(
  '/return-options',
  requireMobileRole(['supervisor', 'admin']),
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `AND s.assigned_supervisor_id = $${params.length}`;
    }
    const { rows: sites } = await query(
      `SELECT s.id, s.site_project_id, s.client_project_name
         FROM sites_master s
        WHERE s.status = 'Active' ${scope}
        ORDER BY s.site_project_id`,
      params
    );
    const { rows: items } = await query(
      `SELECT l.site_id, i.id AS item_id, i.item_code, i.item_name, i.unit,
              SUM(l.net_qty) AS net_qty
         FROM v_site_material_ledger l
         JOIN items_master i ON i.id = l.item_id
        WHERE l.net_qty > 0
        GROUP BY l.site_id, i.id, i.item_code, i.item_name, i.unit
        ORDER BY i.item_code`
    );
    const { rows: vendors } = await query(
      `SELECT id, vendor_name FROM vendors_master WHERE status = 'Active' ORDER BY vendor_name`
    );
    res.json({ sites, items, vendors });
  })
);

/** Supervisor: raise a return from the field app. */
router.post(
  '/returns',
  requireMobileRole(['supervisor', 'admin']),
  wrap(async (req, res) => {
    const created = await tx((client) => raiseReturn(client, req, req.body || {}));
    res.status(201).json(created);
  })
);

/** Supervisor: one-tap handover to the assigned driver. */
router.post(
  '/returns/:id/handover',
  requireMobileRole(['supervisor', 'admin']),
  wrap(async (req, res) => {
    const result = await tx((client) => markHandover(client, req, req.params.id));
    res.json(result);
  })
);

/** Helper: one-tap store receipt with optional arrival photo. */
router.post(
  '/returns/:id/receive',
  requireMobileRole(['store_helper', 'admin']),
  wrap(async (req, res) => {
    const result = await tx((client) => markReceived(client, req, req.params.id, req.body || {}));
    res.json(result);
  })
);

export default router;
