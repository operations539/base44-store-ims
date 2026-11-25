import { Router } from 'express';
import { query } from '../db.js';
import { can, requirePermission } from '../rbac.js';
import { wrap } from '../util.js';
import { mrnStage } from '../operations.js';
import { listReturns } from '../returns.js';

const router = Router();

async function one(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows[0] || {};
}

router.get(
  '/dashboard/summary',
  requirePermission('dashboards.read'),
  wrap(async (req, res) => {
    const withPrice = can(req.user.role, 'stock.price.read');
    const scope = req.user.role === 'supervisor' ? req.user.id : null;

    const [stock, sites, vendors, mrn, po, dc, returns, bills, notifications] = await Promise.all([
      one(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE category = 'High Side')::int AS high_side,
                  count(*) FILTER (WHERE category = 'Low Side')::int AS low_side,
                  count(*) FILTER (WHERE store_physical_stock < 0)::int AS negative,
                  count(*) FILTER (WHERE min_qty_alert > 0 AND store_physical_stock < min_qty_alert)::int AS below_min,
                  COALESCE(SUM(scrap_qty), 0) AS scrap
             FROM items_master`),
      one(`SELECT count(*) FILTER (WHERE status = 'Active')::int AS active,
                  count(*)::int AS total FROM sites_master`),
      one(`SELECT count(*) FILTER (WHERE status = 'Active')::int AS active FROM vendors_master`),
      one(`SELECT count(*) FILTER (WHERE status = 'Pending')::int AS pending,
                  count(*) FILTER (WHERE status IN ('Approved','Partial'))::int AS in_progress,
                  count(*) FILTER (WHERE status = 'Fulfilled')::int AS fulfilled
             FROM material_requests`),
      one(`SELECT count(*) FILTER (WHERE status = 'Pending Approval')::int AS pending_approval,
                  count(*) FILTER (WHERE status IN ('Issued','Sent'))::int AS open
             FROM direct_pos`),
      one(`SELECT count(*) FILTER (WHERE status = 'Issued')::int AS in_transit,
                  count(*) FILTER (WHERE status = 'Issued' AND sla_48h_breach_flag)::int AS awaiting_signed,
                  count(*) FILTER (WHERE signed_dc_photo_url IS NOT NULL)::int AS signed
             FROM challans
            WHERE flow_type IN ('Full Store','Split','Direct Vendor')`),
      one(`SELECT count(*) FILTER (WHERE status IN ('Return Raised','Pickup Assigned','Picked Up','Store Received'))::int AS open,
                  count(*) FILTER (WHERE status IN ('Return Raised','Pickup Assigned','Picked Up','Store Received')
                                     AND sla_48h_breach_flag)::int AS sla_breach,
                  count(*) FILTER (WHERE short_missing_flagged)::int AS short_missing
             FROM challans
            WHERE flow_type IN ('Return Store','Return Vendor')`),
      withPrice
        ? one(`SELECT count(*) FILTER (WHERE bill_status = 'Pending')::int AS pending,
                      COALESCE(SUM(CASE WHEN bill_status = 'Pending' THEN total_amount ELSE 0 END), 0) AS pending_value
                 FROM purchasing_entries`)
        : Promise.resolve({ pending: null, pending_value: null }),
      one(`SELECT count(*) FILTER (WHERE is_read = false)::int AS unread FROM notifications WHERE user_id = $1`, [
        req.user.id,
      ]),
    ]);

    const recent = await query(
      `SELECT a.ts, a.module, a.action, a.record_type, a.record_id, a.remarks, a.emulated,
              u.full_name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.ts DESC LIMIT 6`
    );

    res.json({
      role: req.user.role,
      scopeSupervisor: scope,
      pricingVisible: withPrice,
      stock: {
        ...stock,
        scrap: Number(stock.scrap || 0),
      },
      sites,
      vendors,
      mrn,
      po,
      challans: dc,
      returns,
      bills,
      unreadNotifications: notifications.unread,
      recentActivity: can(req.user.role, 'audit.read') ? recent.rows : [],
    });
  })
);

router.get(
  '/notifications',
  wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    const { rows } = await query(
      `SELECT id, type, title, body, link, severity, is_read, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`,
      [req.user.id]
    );
    res.json({ notifications: rows, unread: rows.filter((r) => !r.is_read).length });
  })
);

router.post(
  '/notifications/:id/read',
  wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

/* ============================================================
 * Layer 3 executive dashboards (read-only, role-scoped)
 * ============================================================ */

// (1) MRN-to-delivery tracker
router.get(
  '/dashboards/mrn-tracker',
  requirePermission('dashboards.read'),
  wrap(async (req, res) => {
    const params = [];
    let scope = '';
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `AND s.assigned_supervisor_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT m.id, m.mrn_no, m.mrn_date, m.required_date, m.status, m.routing_type, m.priority,
              s.site_project_id, s.client_project_name,
              COALESCE((SELECT SUM((l->>'qty')::numeric)
                          FROM jsonb_array_elements(m.line_items) l), 0) AS requested_qty,
              COALESCE((SELECT SUM(COALESCE((l->>'approved_qty')::numeric, (l->>'qty')::numeric))
                          FROM jsonb_array_elements(m.line_items) l), 0) AS approved_qty,
              COALESCE((SELECT SUM(cl.qty)
                          FROM challans c JOIN challan_lines cl ON cl.challan_id = c.id
                         WHERE c.linked_mrn_id = m.id AND c.doc_kind = 'DC'
                           AND c.status <> 'Cancelled'), 0) AS dispatched_qty,
              (CURRENT_DATE - m.mrn_date) AS aging_days
         FROM material_requests m
         JOIN sites_master s ON s.id = m.site_id
        WHERE true ${scope}
        ORDER BY m.mrn_date DESC, m.mrn_no DESC
        LIMIT 500`,
      params
    );

    const { rows: docs } = await query(
      `SELECT linked_mrn_id, doc_kind, status, signed_dc_photo_url
         FROM challans WHERE linked_mrn_id IS NOT NULL`
    );
    const byMrn = new Map();
    for (const doc of docs) {
      if (!byMrn.has(doc.linked_mrn_id)) byMrn.set(doc.linked_mrn_id, []);
      byMrn.get(doc.linked_mrn_id).push(doc);
    }

    const mapped = rows.map((r) => ({
      ...r,
      stage: mrnStage(r.status, byMrn.get(r.id) || []),
      bucket:
        r.status === 'Fulfilled' ? 'Fulfilled' : r.status === 'Partial' ? 'Partial' : r.status === 'Rejected' ? 'Rejected' : 'Open',
    }));

    res.json({
      rows: mapped,
      totals: {
        open: mapped.filter((r) => r.bucket === 'Open').length,
        partial: mapped.filter((r) => r.bucket === 'Partial').length,
        fulfilled: mapped.filter((r) => r.bucket === 'Fulfilled').length,
      },
    });
  })
);

// (2) Live challan status + site-wise signed DC archive
router.get(
  '/dashboards/challans',
  requirePermission('dashboards.read'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.challan_code, c.challan_date, c.flow_type, c.status, c.transport_mode,
              c.driver_delivery_person_name, c.vehicle_no, c.signed_dc_photo_url,
              c.signed_dc_uploaded_at, c.sla_48h_breach_flag, c.site_share_link,
              s.site_project_id, s.client_project_name,
              ROUND(EXTRACT(EPOCH FROM (COALESCE(c.signed_dc_uploaded_at, now()) - c.created_at)) / 3600)::int AS hours_open,
              COALESCE(SUM(cl.qty), 0) AS total_qty,
              count(cl.id)::int AS line_count
         FROM challans c
         LEFT JOIN sites_master s ON s.id = c.site_id
         LEFT JOIN challan_lines cl ON cl.challan_id = c.id
        WHERE c.doc_kind = 'DC' AND c.status <> 'Cancelled'
        GROUP BY c.id, s.site_project_id, s.client_project_name
        ORDER BY c.challan_date DESC, c.challan_code DESC
        LIMIT 500`
    );

    const mapped = rows.map((r) => ({
      ...r,
      signed: !!r.signed_dc_photo_url,
      // Stored SLA flag (set by the scanner) and the live 48-hour calculation
      // must agree, so either one raises the alert.
      missing_48h: !r.signed_dc_photo_url && (r.sla_48h_breach_flag || Number(r.hours_open) > 48),
    }));

    const gallery = [];
    const bySite = new Map();
    for (const row of mapped.filter((r) => r.signed)) {
      const key = row.site_project_id || 'Unassigned';
      if (!bySite.has(key)) {
        const entry = { site_project_id: row.site_project_id, client_project_name: row.client_project_name, documents: [] };
        bySite.set(key, entry);
        gallery.push(entry);
      }
      bySite.get(key).documents.push(row);
    }

    res.json({
      rows: mapped,
      gallery,
      totals: {
        issued: mapped.filter((r) => !r.signed).length,
        signed: mapped.filter((r) => r.signed).length,
        missing_48h: mapped.filter((r) => r.missing_48h).length,
      },
    });
  })
);

// (3) Material return + 48h delay monitor
router.get(
  '/dashboards/returns',
  requirePermission('dashboards.read'),
  wrap(async (req, res) => {
    const rows = await listReturns({ query }, { supervisorId: req.user.role === 'supervisor' ? req.user.id : null });
    const stageOf = (r) => {
      if (r.system_posted_at) return 'System Posted';
      if (r.store_received_at) return 'Store Received';
      if (r.picked_up_at) return 'Picked Up';
      if (r.pickup_assigned_at) return 'Pickup Assigned';
      return 'Return Raised';
    };
    const mapped = rows.map((r) => ({
      ...r,
      stage: stageOf(r),
      overdue: !r.system_posted_at && Number(r.hours_open) > 48,
    }));
    res.json({
      rows: mapped,
      totals: {
        open: mapped.filter((r) => !r.system_posted_at).length,
        open_pickups: mapped.filter((r) => r.status === 'Pickup Assigned').length,
        overdue: mapped.filter((r) => r.overdue).length,
        short_missing: mapped.filter((r) => r.short_missing_flagged).length,
      },
    });
  })
);

// (4) Live high side / low side stock + site material ledger
router.get(
  '/dashboards/stock',
  requirePermission('dashboards.read'),
  wrap(async (req, res) => {
    const withPrice = can(req.user.role, 'stock.price.read');
    const { rows } = await query(
      `SELECT id, item_code, item_name, category, unit, store_physical_stock, min_qty_alert,
              scrap_qty, latest_rate
         FROM items_master
        ORDER BY category DESC, item_code`
    );
    const items = rows.map((r) => ({
      ...r,
      latest_rate: withPrice ? r.latest_rate : null,
      minus: Number(r.store_physical_stock) < 0,
      below_min: Number(r.min_qty_alert) > 0 && Number(r.store_physical_stock) < Number(r.min_qty_alert),
    }));

    const { rows: unitTotals } = await query(
      `SELECT unit, count(*)::int AS items,
              COALESCE(SUM(store_physical_stock), 0) AS stock,
              COALESCE(SUM(scrap_qty), 0) AS scrap
         FROM items_master GROUP BY unit ORDER BY unit`
    );

    const { rows: siteLedger } = await query(
      `SELECT s.site_project_id, s.client_project_name, i.item_code, i.item_name, i.unit,
              l.issued_qty, l.returned_qty, l.net_qty
         FROM v_site_material_ledger l
         JOIN sites_master s ON s.id = l.site_id
         JOIN items_master i ON i.id = l.item_id
        ORDER BY s.site_project_id, i.item_code`
    );

    res.json({
      rows: items,
      unitTotals,
      siteLedger,
      pricingVisible: withPrice,
      totals: {
        minus: items.filter((i) => i.minus).length,
        below_min: items.filter((i) => i.below_min).length,
      },
    });
  })
);

// (5) Damaged / scrap / short-missing + pending vendor bills
router.get(
  '/dashboards/scrap-bills',
  requirePermission('dashboards.read'),
  wrap(async (req, res) => {
    const withPrice = can(req.user.role, 'stock.price.read');
    const [scrap, shortReturns, bills] = await Promise.all([
      query(
        `SELECT i.item_code, i.item_name, i.unit, i.scrap_qty, i.category
           FROM items_master i WHERE i.scrap_qty > 0 ORDER BY i.scrap_qty DESC`
      ),
      query(
        `SELECT c.id, c.challan_code, c.challan_date, c.system_posted_at, c.short_missing_remarks,
                s.site_project_id, s.client_project_name,
                COALESCE(SUM(cl.short_missing_qty), 0) AS short_qty
           FROM challans c
           LEFT JOIN sites_master s ON s.id = c.site_id
           LEFT JOIN challan_lines cl ON cl.challan_id = c.id
          WHERE c.doc_kind = 'RET' AND c.short_missing_flagged = true
          GROUP BY c.id, s.site_project_id, s.client_project_name
          ORDER BY c.system_posted_at DESC NULLS LAST`
      ),
      query(
        `SELECT p.purchase_id, p.entry_date, p.qty, p.rate, p.bill_status, p.bill_no,
                p.account_verification_status, p.erp_sync_status,
                v.vendor_name, i.item_code, i.item_name, i.unit, po.po_code
           FROM purchasing_entries p
           JOIN vendors_master v ON v.id = p.vendor_id
           JOIN items_master i ON i.id = p.item_id
           LEFT JOIN direct_pos po ON po.id = p.linked_po_id
          WHERE p.bill_status = 'Pending' OR p.rate = 0
          ORDER BY p.entry_date DESC
          LIMIT 500`
      ),
    ]);

    res.json({
      rows: scrap.rows,
      shortReturns: shortReturns.rows,
      bills: bills.rows.map((b) => ({ ...b, rate: withPrice ? b.rate : null })),
      pricingVisible: withPrice,
      totals: {
        scrap_items: scrap.rows.length,
        short_returns: shortReturns.rows.length,
        pending_bills: bills.rows.length,
      },
    });
  })
);

export default router;
