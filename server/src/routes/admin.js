import { Router } from 'express';
import { query, tx, recomputeItemBalances } from '../db.js';
import { requirePermission } from '../rbac.js';
import { HttpError, wrap } from '../util.js';
import { writeAudit } from '../audit.js';

const router = Router();

const DEMO_TABLES = [
  ['notifications', 'Notifications'],
  ['message_logs', 'Message logs'],
  ['challans', 'Challans & return tracking'],
  ['purchasing_entries', 'Purchasing entries'],
  ['direct_pos', 'Direct POs'],
  ['material_requests', 'Material requests'],
  ['stock_movements', 'Stock movements'],
  ['sites_master', 'Sites'],
  ['items_master', 'Items'],
  ['vendors_master', 'Vendors'],
  ['users', 'Demo users'],
];

router.get(
  '/demo/summary',
  requirePermission('demo.reset'),
  wrap(async (req, res) => {
    const counts = [];
    for (const [table, label] of DEMO_TABLES) {
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE is_demo = true`);
      counts.push({ table, label, count: rows[0].n });
    }
    const { rows: auditRows } = await query(
      'SELECT count(*)::int AS n FROM audit_logs WHERE is_demo = true'
    );
    counts.push({ table: 'audit_logs', label: 'Demo audit entries', count: auditRows[0].n });
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    res.json({ counts, total });
  })
);

router.post(
  '/demo/clear',
  requirePermission('demo.reset'),
  wrap(async (req, res) => {
    const confirm = String(req.body?.confirm || '').trim().toUpperCase();
    if (confirm !== 'CLEAR DEMO DATA') {
      throw new HttpError(400, 'Type CLEAR DEMO DATA to confirm.', { confirm: 'Confirmation text does not match' });
    }

    const removed = await tx(async (client) => {
      const result = {};
      const order = [
        'notifications',
        'message_logs',
        'audit_logs',
        'challans',
        'purchasing_entries',
        'direct_pos',
        'material_requests',
        'stock_movements',
        'sites_master',
        'items_master',
        'vendors_master',
        'users',
      ];
      for (const table of order) {
        const { rowCount } = await client.query(`DELETE FROM ${table} WHERE is_demo = true`);
        result[table] = rowCount;
      }

      const { rows } = await client.query('SELECT id FROM items_master');
      await recomputeItemBalances(client, rows.map((r) => r.id));

      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'demo_data',
        recordId: 'demo-reset',
        action: 'CLEAR_DEMO_DATA',
        newValues: result,
      });
      return result;
    });

    res.json({ ok: true, removed });
  })
);

router.post(
  '/demo/restore',
  requirePermission('demo.reset'),
  wrap(async (req, res) => {
    const { seedDemo } = await import('../seed.js');
    const summary = await seedDemo();
    await tx(async (client) => {
      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'demo_data',
        recordId: 'demo-seed',
        action: 'RESTORE_DEMO_DATA',
        newValues: summary,
      });
    });
    res.json({ ok: true, summary });
  })
);

export default router;
