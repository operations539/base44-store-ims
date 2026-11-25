import { Router } from 'express';
import { query, tx } from '../db.js';
import { can, requirePermission } from '../rbac.js';
import { denied, wrap } from '../util.js';
import {
  assignPickup,
  attachSignedReturnDc,
  getReturn,
  listReturns,
  markHandover,
  markReceived,
  postReturn,
  raiseReturn,
} from '../returns.js';

const router = Router();

function supervisorScope(req) {
  return req.user.role === 'supervisor' ? req.user.id : null;
}

router.get(
  '/returns',
  requirePermission('returns.read'),
  wrap(async (req, res) => {
    const statuses = req.query.status ? String(req.query.status).split(',') : null;
    const rows = await listReturns({ query }, { supervisorId: supervisorScope(req), statuses });
    res.json({ returns: rows });
  })
);

router.get(
  '/returns/:id',
  requirePermission('returns.read'),
  wrap(async (req, res) => {
    const detail = await getReturn({ query }, req.params.id);
    res.json({ return: detail });
  })
);

router.post(
  '/returns',
  requirePermission('returns.raise'),
  wrap(async (req, res) => {
    const created = await tx((client) => raiseReturn(client, req, req.body || {}));
    res.status(201).json(created);
  })
);

router.post(
  '/returns/:id/pickup',
  requirePermission('returns.pickup'),
  wrap(async (req, res) => {
    const result = await tx((client) => assignPickup(client, req, req.params.id, req.body || {}));
    res.json(result);
  })
);

router.post(
  '/returns/:id/handover',
  requirePermission('returns.read'),
  wrap(async (req, res) => {
    if (!can(req.user.role, 'returns.pickup') && !can(req.user.role, 'returns.raise')) {
      throw denied('Only the site or the store team can mark the handover.');
    }
    const result = await tx((client) => markHandover(client, req, req.params.id));
    res.json(result);
  })
);

router.post(
  '/returns/:id/receive',
  requirePermission('returns.receive'),
  wrap(async (req, res) => {
    const result = await tx((client) => markReceived(client, req, req.params.id, req.body || {}));
    res.json(result);
  })
);

router.post(
  '/returns/:id/signed-dc',
  requirePermission('returns.post'),
  wrap(async (req, res) => {
    const result = await tx((client) => attachSignedReturnDc(client, req, req.params.id, req.body || {}));
    res.json(result);
  })
);

router.post(
  '/returns/:id/post',
  requirePermission('returns.post'),
  wrap(async (req, res) => {
    const result = await tx((client) => postReturn(client, req, req.params.id, req.body || {}));
    res.json(result);
  })
);

export default router;
