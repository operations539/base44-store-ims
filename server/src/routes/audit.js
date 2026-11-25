import { Router } from 'express';
import { query } from '../db.js';
import { requirePermission } from '../rbac.js';
import { wrap } from '../util.js';

const router = Router();

router.get(
  '/',
  requirePermission('audit.read'),
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.module) {
      params.push(String(req.query.module));
      where.push(`a.module = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      where.push(`(lower(a.action) LIKE $${params.length} OR lower(COALESCE(a.remarks,'')) LIKE $${params.length}
                   OR lower(COALESCE(u.full_name,'')) LIKE $${params.length})`);
    }
    params.push(Math.min(Number(req.query.limit) || 100, 300));

    const { rows } = await query(
      `SELECT a.id, a.ts, a.module, a.action, a.record_type, a.record_id,
              a.old_values, a.new_values, a.remarks, a.emulated, a.actor_role,
              u.full_name AS actor_name, u.email AS actor_email,
              e.full_name AS effective_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         LEFT JOIN users e ON e.id = a.effective_user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.ts DESC
        LIMIT $${params.length}`,
      params
    );

    res.json({ logs: rows });
  })
);

export default router;
