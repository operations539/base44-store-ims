import { Router } from 'express';
import { query } from '../db.js';
import { requirePermission } from '../rbac.js';
import { wrap } from '../util.js';

const router = Router();

/**
 * Derived site side of the two-ledger system. Quantities only — no rates, so
 * the ledger is safe for every role that can read it (supervisors included).
 */
router.get(
  '/site-ledger',
  requirePermission('ledger.read'),
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      where.push(`s.assigned_supervisor_id = $${params.length}`);
    }
    if (req.query.site_id) {
      params.push(String(req.query.site_id));
      where.push(`l.site_id = $${params.length}`);
    }
    if (req.query.item_id) {
      params.push(String(req.query.item_id));
      where.push(`l.item_id = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(lower(i.item_name) LIKE $${params.length}
                   OR lower(i.item_code) LIKE $${params.length}
                   OR lower(s.site_project_id) LIKE $${params.length})`);
    }

    const { rows } = await query(
      `SELECT l.site_id, l.item_id, l.issued_qty, l.returned_qty, l.net_qty,
              s.site_project_id, s.client_project_name,
              i.item_code, i.item_name, i.model_no, i.category, i.unit
         FROM v_site_material_ledger l
         JOIN sites_master s ON s.id = l.site_id
         JOIN items_master i ON i.id = l.item_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.site_project_id, i.category DESC, i.item_name
        LIMIT 500`,
      params
    );

    res.json({
      entries: rows,
      totals: {
        issued: rows.reduce((sum, r) => sum + Number(r.issued_qty || 0), 0),
        returned: rows.reduce((sum, r) => sum + Number(r.returned_qty || 0), 0),
        net: rows.reduce((sum, r) => sum + Number(r.net_qty || 0), 0),
      },
    });
  })
);

export default router;
