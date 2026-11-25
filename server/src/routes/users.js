import { Router } from 'express';
import { query, tx } from '../db.js';
import { hashPassword, publicUser } from '../auth.js';
import { ROLE_LABELS, ROLES, requirePermission } from '../rbac.js';
import {
  DEPARTMENTS,
  HttpError,
  normalizePhone,
  requiredStr,
  str,
  wrap,
} from '../util.js';
import { writeAudit } from '../audit.js';

const router = Router();

const BASE = `id, email, username, full_name, role, employee_id, department_code, phone,
  is_active, is_demo, last_login_at, created_at`;

router.get(
  '/users',
  requirePermission('users.manage'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT ${BASE} FROM users ORDER BY
         CASE role WHEN 'admin' THEN 0 WHEN 'owner' THEN 1 WHEN 'store_manager' THEN 2
                   WHEN 'store_exec' THEN 3 WHEN 'store_helper' THEN 4 ELSE 5 END,
         full_name`
    );
    res.json({ users: rows.map(publicUser), roles: ROLE_LABELS });
  })
);

router.post(
  '/users',
  requirePermission('users.manage'),
  wrap(async (req, res) => {
    const body = req.body || {};
    const fullName = requiredStr(body.full_name, 'Full name', { max: 120 });
    const email = requiredStr(body.email, 'Email', { max: 160 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, 'Enter a valid email address.', { email: 'Invalid email' });
    }
    const role = requiredStr(body.role, 'Role');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a valid role.', { role: 'Invalid role' });

    const department = str(body.department_code);
    if (department && !DEPARTMENTS.includes(department)) {
      throw new HttpError(400, 'Choose a valid department.', { department_code: 'Invalid department' });
    }

    const phoneRaw = str(body.phone);
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (phoneRaw && !phone) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number.', { phone: 'Invalid number' });

    const password = String(body.password || '');
    if (password.length < 8) {
      throw new HttpError(400, 'Set a temporary password of at least 8 characters.', {
        password: 'Minimum 8 characters',
      });
    }

    const duplicate = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (duplicate.rows.length) {
      throw new HttpError(400, 'A user with that email already exists.', { email: 'Already exists' });
    }

    const created = await tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, username, password_hash, full_name, role, employee_id,
                            department_code, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING ${BASE}`,
        [
          email,
          str(body.username)?.toLowerCase() || null,
          hashPassword(password),
          fullName,
          role,
          str(body.employee_id, { max: 40 }),
          department,
          phone,
        ]
      );
      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'users',
        recordId: rows[0].id,
        action: 'CREATE_USER',
        newValues: { email, role, full_name: fullName },
      });
      return rows[0];
    });

    res.status(201).json({ user: publicUser(created) });
  })
);

router.patch(
  '/users/:id',
  requirePermission('users.manage'),
  wrap(async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const existing = await query(`SELECT ${BASE}, password_hash FROM users WHERE id = $1`, [id]);
    const current = existing.rows[0];
    if (!current) throw new HttpError(404, 'User not found.');

    const next = {
      full_name: body.full_name !== undefined ? requiredStr(body.full_name, 'Full name') : current.full_name,
      role: body.role !== undefined ? String(body.role) : current.role,
      employee_id: body.employee_id !== undefined ? str(body.employee_id, { max: 40 }) : current.employee_id,
      department_code:
        body.department_code !== undefined ? str(body.department_code) : current.department_code,
      phone: body.phone !== undefined ? normalizePhone(body.phone) : current.phone,
      is_active: body.is_active !== undefined ? !!body.is_active : current.is_active,
    };

    if (!ROLES.includes(next.role)) throw new HttpError(400, 'Choose a valid role.', { role: 'Invalid role' });
    if (next.department_code && !DEPARTMENTS.includes(next.department_code)) {
      throw new HttpError(400, 'Choose a valid department.', { department_code: 'Invalid department' });
    }
    if (body.phone && !next.phone) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number.', { phone: 'Invalid number' });

    // Guards: never let the last administrator lock themselves out.
    if (current.id === req.actor.id) {
      if (!next.is_active) throw new HttpError(400, 'You cannot deactivate your own account.');
      if (next.role !== 'admin') throw new HttpError(400, 'You cannot change your own administrator role.');
    }
    if (current.role === 'admin' && (next.role !== 'admin' || !next.is_active)) {
      const { rows } = await query(
        "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active = true AND id <> $1",
        [current.id]
      );
      if (rows[0].n === 0) throw new HttpError(400, 'At least one active administrator must remain.');
    }

    const password = body.password ? String(body.password) : null;
    if (password && password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters.', { password: 'Minimum 8 characters' });
    }

    const updated = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET full_name=$2, role=$3, employee_id=$4, department_code=$5,
                phone=$6, is_active=$7, password_hash = COALESCE($8, password_hash)
          WHERE id = $1
          RETURNING ${BASE}`,
        [
          id,
          next.full_name,
          next.role,
          next.employee_id,
          next.department_code,
          next.phone,
          next.is_active,
          password ? hashPassword(password) : null,
        ]
      );
      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'users',
        recordId: id,
        action: 'UPDATE_USER',
        oldValues: {
          role: current.role,
          is_active: current.is_active,
          full_name: current.full_name,
          department_code: current.department_code,
        },
        newValues: {
          role: next.role,
          is_active: next.is_active,
          full_name: next.full_name,
          department_code: next.department_code,
          password_reset: !!password,
        },
      });
      return rows[0];
    });

    // Password change or deactivation ends that user's sessions.
    if (password || !next.is_active) {
      await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    }

    res.json({ user: publicUser(updated) });
  })
);

export default router;
