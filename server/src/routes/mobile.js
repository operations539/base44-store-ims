import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, wrap } from '../util.js';

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
              c.signed_dc_photo_url, c.sla_48h_breach_flag, c.transport_mode,
              c.driver_delivery_person_name,
              s.site_project_id, s.client_project_name,
              COALESCE(SUM(cl.qty), 0) AS total_qty,
              count(cl.id)::int AS line_count
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE c.flow_type IN ('Full Store','Split','Direct Vendor')
          AND c.status IN ('Issued','Delivered-Signed')
        GROUP BY c.id, s.site_project_id, s.client_project_name
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
    res.json({ requests: rows });
  })
);

/** Supervisor: return requests; Helper: returns awaiting store receipt. */
router.get(
  '/returns',
  requireMobileRole(['supervisor', 'store_helper', 'admin']),
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    let statusFilter = "c.status IN ('Return Raised','Pickup Assigned','Picked Up','Store Received')";

    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `AND s.assigned_supervisor_id = $${params.length}`;
    } else if (req.user.role === 'store_helper') {
      statusFilter = "c.status IN ('Picked Up','Store Received')";
    }

    const { rows } = await query(
      `SELECT c.id, c.challan_code, c.challan_date, c.status, c.flow_type,
              c.transport_mode, c.driver_delivery_person_name, c.driver_phone, c.vehicle_no,
              c.return_raised_at, c.pickup_assigned_at, c.picked_up_at, c.store_received_at,
              c.system_posted_at, c.short_missing_flagged, c.signed_return_dc_photo_url,
              s.site_project_id, s.client_project_name,
              COALESCE(SUM(cl.qty), 0) AS total_qty,
              count(cl.id)::int AS line_count
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE c.flow_type IN ('Return Store','Return Vendor') AND ${statusFilter} ${scope}
        GROUP BY c.id, s.site_project_id, s.client_project_name
        ORDER BY c.return_raised_at DESC NULLS LAST, c.challan_code DESC
        LIMIT 40`,
      params
    );
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
      `SELECT m.id, m.mrn_no, m.mrn_date, m.status, m.routing_type, m.priority,
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
    res.json({ tracking: rows });
  })
);

export default router;
