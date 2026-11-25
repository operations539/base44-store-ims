import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import {
  createSession,
  destroySession,
  publicUser,
  requireAuth,
  sessionPayload,
  verifyPassword,
} from '../auth.js';
import { permissionsFor } from '../rbac.js';
import { HttpError, wrap } from '../util.js';
import { writeAudit } from '../audit.js';
import { tx } from '../db.js';

const router = Router();

// Very small in-memory throttle: 8 failures per identifier/IP per 10 minutes.
const failures = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

function throttleKey(req, identifier) {
  return `${req.ip}|${String(identifier || '').toLowerCase()}`;
}

function tooManyAttempts(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  return res.json(sessionPayload(req));
});

router.post(
  '/login',
  wrap(async (req, res) => {
    const identifier = String(req.body?.identifier || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!identifier || !password) {
      throw new HttpError(400, 'Enter your email/username and password.', {
        identifier: identifier ? null : 'Required',
        password: password ? null : 'Required',
      });
    }

    const key = throttleKey(req, identifier);
    if (tooManyAttempts(key)) {
      throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
    }

    const { rows } = await query(
      `SELECT id, password_hash, is_active FROM users
        WHERE lower(email) = $1 OR lower(username) = $1
        LIMIT 1`,
      [identifier]
    );
    const user = rows[0];
    const ok = user && user.is_active && verifyPassword(password, user.password_hash);

    if (!ok) {
      recordFailure(key);
      throw new HttpError(401, 'Those credentials do not match an active account.');
    }
    failures.delete(key);

    await createSession(res, {
      userId: user.id,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    const fresh = await query('SELECT * FROM users WHERE id = $1', [user.id]);
    res.json({
      user: publicUser(fresh.rows[0]),
      permissions: permissionsFor(fresh.rows[0].role),
    });
  })
);

router.post(
  '/logout',
  wrap(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  })
);

// ---------------- Google OAuth (admin-invited users only) ----------------
function googleRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

router.get('/google/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect('/login?error=google_not_configured');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('km_oauth_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get(
  '/google/callback',
  wrap(async (req, res) => {
    const { code, state } = req.query;
    const expected = req.cookies?.km_oauth_state;
    res.clearCookie('km_oauth_state', { path: '/' });

    if (!code || !state || state !== expected) return res.redirect('/login?error=google_state');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect('/login?error=google_not_configured');
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: googleRedirectUri(req),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return res.redirect('/login?error=google_token');
      const token = await tokenRes.json();

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!profileRes.ok) return res.redirect('/login?error=google_profile');
      const profile = await profileRes.json();
      const email = String(profile.email || '').toLowerCase();
      if (!email) return res.redirect('/login?error=google_profile');

      const { rows } = await query(
        'SELECT id, is_active FROM users WHERE lower(email) = $1 LIMIT 1',
        [email]
      );
      if (!rows.length) return res.redirect('/login?error=not_invited');
      if (!rows[0].is_active) return res.redirect('/login?error=inactive');

      await query('UPDATE users SET google_sub = $2, last_login_at = now() WHERE id = $1', [
        rows[0].id,
        profile.sub || null,
      ]);
      await createSession(res, {
        userId: rows[0].id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.redirect('/');
    } catch {
      return res.redirect('/login?error=google_failed');
    }
  })
);

// ---------------- Emulation (admin only) ----------------
router.post(
  '/emulate',
  requireAuth,
  wrap(async (req, res) => {
    if (req.actor?.role !== 'admin' || req.emulated) {
      throw new HttpError(403, 'Only the signed-in administrator can start an emulation.');
    }
    const targetId = String(req.body?.user_id || '');
    const { rows } = await query('SELECT id, full_name, role, is_active FROM users WHERE id = $1', [targetId]);
    const target = rows[0];
    if (!target) throw new HttpError(404, 'User not found.');
    if (!target.is_active) throw new HttpError(400, 'That user is deactivated.');
    if (target.role === 'admin') throw new HttpError(400, 'Emulating another administrator is not allowed.');

    await query('UPDATE sessions SET emulated_user_id = $2 WHERE id = $1', [req.session.id, target.id]);

    await tx(async (client) => {
      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'users',
        recordId: target.id,
        action: 'EMULATE_START',
        emulated: true,
        effectiveUserId: target.id,
        remarks: `Admin ${req.actor.full_name} started viewing as ${target.full_name}`,
      });
    });

    res.json({ ok: true });
  })
);

router.post(
  '/emulate/exit',
  requireAuth,
  wrap(async (req, res) => {
    if (!req.emulated) return res.json({ ok: true });
    const emulatedName = req.user?.full_name;
    await query('UPDATE sessions SET emulated_user_id = NULL WHERE id = $1', [req.session.id]);
    await tx(async (client) => {
      await writeAudit(client, req, {
        module: 'Admin',
        recordType: 'users',
        recordId: req.user?.id,
        action: 'EMULATE_END',
        remarks: `Admin ${req.actor.full_name} stopped viewing as ${emulatedName}`,
      });
    });
    res.json({ ok: true });
  })
);

export default router;
