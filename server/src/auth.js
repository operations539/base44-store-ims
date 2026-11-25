import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { ROLE_LABELS, ROLE_TAGS, mobileNavFor, navFor, permissionsFor } from './rbac.js';

export const COOKIE_NAME = 'km_session';
const SESSION_DAYS = 7;

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

const USER_COLUMNS = `u.id, u.email, u.username, u.full_name, u.role, u.employee_id,
  u.department_code, u.phone, u.is_active, u.is_demo, u.last_login_at, u.created_at, u.updated_at`;

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    roleTag: ROLE_TAGS[row.role] || row.role,
    employee_id: row.employee_id,
    department_code: row.department_code,
    phone: row.phone,
    is_active: row.is_active,
    is_demo: row.is_demo,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createSession(res, { userId, ip, userAgent }) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await query(
    `INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sha256(token), userId, ip || null, userAgent || null, expires]
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  return rows[0].id;
}

export async function destroySession(req, res) {
  const raw = req.cookies?.[COOKIE_NAME];
  if (raw) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(raw)]);
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Resolve the session cookie into req.actor / req.user (effective identity). */
export async function attachSession(req, res, next) {
  try {
    const raw = req.cookies?.[COOKIE_NAME];
    if (!raw) return next();

    const { rows } = await query(
      `SELECT s.id AS session_id, s.emulated_user_id,
              ${USER_COLUMNS}
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(raw)]
    );
    if (!rows.length) return next();

    const session = rows[0];
    if (!session.is_active) return next();

    let effective = session;
    let emulated = false;

    if (session.emulated_user_id && session.role === 'admin') {
      const target = await query(
        `SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 AND u.is_active = true`,
        [session.emulated_user_id]
      );
      if (target.rows.length) {
        effective = target.rows[0];
        emulated = true;
      }
    }

    req.session = { id: session.session_id, emulated_user_id: session.emulated_user_id || null };
    req.actor = publicUser(session);
    req.user = publicUser(effective);
    req.emulated = emulated;
    req.ipAddress = req.ip;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  return next();
}

/** Identity payload the SPA renders the shell from. */
export function sessionPayload(req) {
  return {
    user: req.user,
    actor: req.actor,
    emulated: !!req.emulated,
    permissions: permissionsFor(req.user.role),
    nav: navFor(req.user.role),
    mobileNav: mobileNavFor(req.user.role),
    googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}
