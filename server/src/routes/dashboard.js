import { Router } from 'express';
import { query } from '../db.js';
import { can, requirePermission } from '../rbac.js';
import { wrap } from '../util.js';

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

export default router;
