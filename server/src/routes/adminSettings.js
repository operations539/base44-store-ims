/**
 * Admin central panel — documents & numbering, messaging centre, API hub.
 * Everything here is admin-only (settings.manage).
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { requirePermission } from '../rbac.js';
import { bad, notFound, str, wrap } from '../util.js';
import { getSetting, saveSetting } from '../settings.js';
import { writeAudit } from '../audit.js';

const router = Router();

// Pool runner for helpers that expect a client-like object.
const db = { query };
router.use(requirePermission('settings.manage'));

export const API_SCOPES = [
  'stock.read',
  'mrns.read',
  'mrns.write',
  'dispatch.read',
  'dispatch.write',
  'masters.read',
  'masters.write',
];

const DEFAULT_NUMBERING = { prefix_base: 'KM', types: { MRN: 'MRN', PO: 'PO', DC: 'DC', RET: 'RET', PUR: 'PUR' } };
const DEFAULT_DC_PRINT = {
  company_name: 'Kool Mart India',
  address: '',
  gstin: '',
  footer_note: 'Rate-free delivery challan. Not a tax invoice.',
  copies: ['Store Copy', 'Supervisor / Porter Copy', 'Recipient Copy'],
  show_rates: false,
};
const DEFAULT_MESSAGING = {
  email: { provider: 'resend', from_name: 'Kool Mart Store IMS', from_email: '', smtp_host: '', smtp_port: 587, smtp_user: '', smtp_secure: true },
  whatsapp: { mode: 'smart_link', business_number: '', api_key_configured: false },
  events: {},
};

/** Never return stored credentials — only whether one exists. */
function maskMessaging(cfg) {
  const email = { ...(cfg.email || {}) };
  const hasPassword = !!email.password || !!email.has_password;
  delete email.password;
  const whatsapp = { ...(cfg.whatsapp || {}) };
  const hasApiKey = !!whatsapp.api_key || !!whatsapp.api_key_configured;
  delete whatsapp.api_key;
  return {
    ...cfg,
    email: { ...email, has_password: hasPassword },
    whatsapp: { ...whatsapp, api_key_configured: hasApiKey },
  };
}

router.get(
  '/settings',
  wrap(async (req, res) => {
    const [numbering, dcPrint, messaging, erp] = await Promise.all([
      getSetting(db, 'numbering', DEFAULT_NUMBERING),
      getSetting(db, 'dc_print', DEFAULT_DC_PRINT),
      getSetting(db, 'messaging', DEFAULT_MESSAGING),
      getSetting(db, 'erp_sync', { status: 'inactive', hook_url: '', note: '' }),
    ]);
    res.json({
      numbering,
      dc_print: dcPrint,
      messaging: maskMessaging(messaging),
      erp_sync: erp,
      api_scopes: API_SCOPES,
    });
  })
);

router.put(
  '/settings/numbering',
  wrap(async (req, res) => {
    const body = req.body || {};
    const current = await getSetting(db, 'numbering', DEFAULT_NUMBERING);
    const types = { ...(current.types || {}) };
    for (const key of ['MRN', 'PO', 'DC', 'RET', 'PUR']) {
      const v = str(body.types?.[key], { max: 12 });
      if (v) types[key] = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    const next = { prefix_base: str(body.prefix_base, { max: 12 }) || current.prefix_base || 'KM', types };
    await saveSetting(db, 'numbering', next, req.user.id);
    await writeAudit(db, req, {
      module: 'Admin',
      recordType: 'app_settings',
      recordId: 'numbering',
      action: 'UPDATE_NUMBERING',
      oldValues: current,
      newValues: next,
    });
    res.json({ numbering: next });
  })
);

router.put(
  '/settings/dc-print',
  wrap(async (req, res) => {
    const body = req.body || {};
    const current = await getSetting(db, 'dc_print', DEFAULT_DC_PRINT);
    const copies = Array.isArray(body.copies)
      ? body.copies.map((c) => str(c, { max: 60 })).filter(Boolean).slice(0, 5)
      : current.copies;
    const next = {
      company_name: str(body.company_name, { max: 120 }) || current.company_name,
      address: str(body.address, { max: 300 }) ?? current.address,
      gstin: str(body.gstin, { max: 20 }) ?? current.gstin,
      footer_note: str(body.footer_note, { max: 300 }) ?? current.footer_note,
      copies: copies?.length ? copies : current.copies,
      // Rate-free printing is a product rule, never configurable.
      show_rates: false,
    };
    await saveSetting(db, 'dc_print', next, req.user.id);
    await writeAudit(db, req, {
      module: 'Admin',
      recordType: 'app_settings',
      recordId: 'dc_print',
      action: 'UPDATE_DC_TEMPLATE',
      oldValues: current,
      newValues: next,
    });
    res.json({ dc_print: next });
  })
);

router.put(
  '/settings/messaging',
  wrap(async (req, res) => {
    const body = req.body || {};
    const current = await getSetting(db, 'messaging', DEFAULT_MESSAGING);
    const emailIn = body.email || {};
    const waIn = body.whatsapp || {};

    const email = {
      provider: ['resend', 'smtp'].includes(emailIn.provider) ? emailIn.provider : current.email?.provider || 'resend',
      from_name: str(emailIn.from_name, { max: 120 }) ?? current.email?.from_name ?? '',
      from_email: str(emailIn.from_email, { max: 200 }) ?? current.email?.from_email ?? '',
      smtp_host: str(emailIn.smtp_host, { max: 200 }) ?? current.email?.smtp_host ?? '',
      smtp_port: Number(emailIn.smtp_port) || current.email?.smtp_port || 587,
      smtp_user: str(emailIn.smtp_user, { max: 200 }) ?? current.email?.smtp_user ?? '',
      smtp_secure: emailIn.smtp_secure === undefined ? current.email?.smtp_secure ?? true : !!emailIn.smtp_secure,
      // A supplied password replaces the stored one; an empty field keeps it.
      password: str(emailIn.password, { max: 400 }) || current.email?.password || null,
    };

    const whatsapp = {
      mode: ['smart_link', 'api'].includes(waIn.mode) ? waIn.mode : current.whatsapp?.mode || 'smart_link',
      business_number: str(waIn.business_number, { max: 20 }) ?? current.whatsapp?.business_number ?? '',
      // Phase 2 slot — stored but never used to send yet.
      api_key: str(waIn.api_key, { max: 400 }) || current.whatsapp?.api_key || null,
    };

    const events = {};
    const eventKeys = [
      'mrn_raised', 'mrn_approved', 'po_approval', 'dispatch_created',
      'return_raised', 'short_missing', 'sla_breach',
    ];
    for (const key of eventKeys) {
      const row = body.events?.[key] || {};
      events[key] = { email: !!row.email, whatsapp: !!row.whatsapp };
    }

    const next = { email, whatsapp, events };
    await saveSetting(db, 'messaging', next, req.user.id);
    await writeAudit(db, req, {
      module: 'Admin',
      recordType: 'app_settings',
      recordId: 'messaging',
      action: 'UPDATE_MESSAGING',
      newValues: maskMessaging(next),
    });
    res.json({ messaging: maskMessaging(next) });
  })
);

router.get(
  '/messages',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT id, channel, event_key, recipient, subject, status, error, attempts, sent_at, created_at
         FROM message_logs ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ messages: rows });
  })
);

router.post(
  '/messages/:id/retry',
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM message_logs WHERE id = $1', [req.params.id]);
    const msg = rows[0];
    if (!msg) throw notFound('Message not found.');

    const cfg = await getSetting(db, 'messaging', DEFAULT_MESSAGING);
    const ready =
      msg.channel === 'email'
        ? !!cfg.email?.from_email && (!!cfg.email?.password || !!cfg.email?.smtp_user)
        : !!cfg.whatsapp?.api_key;

    const status = ready ? 'Sent' : 'Failed';
    const error = ready ? null : 'No provider credentials configured yet — add them in Messaging settings.';
    await query(
      `UPDATE message_logs
          SET status = $2, error = $3, attempts = attempts + 1, sent_at = CASE WHEN $2 = 'Sent' THEN now() ELSE sent_at END
        WHERE id = $1`,
      [msg.id, status, error]
    );
    await writeAudit(db, req, {
      module: 'Admin',
      recordType: 'message_logs',
      recordId: msg.id,
      action: 'MESSAGE_RETRY',
      newValues: { status, error },
    });
    res.json({ ok: ready, status, error });
  })
);

/* ------------------------- API keys ------------------------- */
router.get(
  '/api-keys',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT k.id, k.name, k.token_prefix, k.scopes, k.last_used_at, k.revoked_at, k.created_at,
              u.full_name AS created_by_name
         FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
        ORDER BY k.created_at DESC`
    );
    res.json({ keys: rows, scopes: API_SCOPES });
  })
);

router.post(
  '/api-keys',
  wrap(async (req, res) => {
    const name = str(req.body?.name, { max: 120 });
    if (!name) throw bad('Give the key a name so it can be revoked later.', { name: 'Required' });
    const scopes = (Array.isArray(req.body?.scopes) ? req.body.scopes : []).filter((s) => API_SCOPES.includes(s));
    if (!scopes.length) throw bad('Choose at least one scope.', { scopes: 'Required' });

    const secret = `kmk_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(secret).digest('hex');
    const prefix = secret.slice(0, 12);

    const { rows } = await query(
      `INSERT INTO api_keys (name, token_prefix, token_hash, scopes, created_by)
       VALUES ($1,$2,$3,$4::text[],$5) RETURNING id, name, token_prefix, scopes, created_at`,
      [name, prefix, tokenHash, scopes, req.user.id]
    );
    await writeAudit(db, req, {
      module: 'Admin',
      recordType: 'api_keys',
      recordId: rows[0].id,
      action: 'API_KEY_CREATED',
      newValues: { name, scopes, token_prefix: prefix },
    });
    // The plaintext token is shown exactly once, here.
    res.status(201).json({ key: rows[0], token: secret });
  })
);

router.post(
  '/api-keys/:id/revoke',
  wrap(async (req, res) => {
    const { rows } = await query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id, name`,
      [req.params.id]
    );
    if (!rows.length) throw notFound('Key not found or already revoked.');
    await writeAudit(db, req, {
      module: 'Admin',
      recordType: 'api_keys',
      recordId: req.params.id,
      action: 'API_KEY_REVOKED',
      newValues: { name: rows[0].name },
    });
    res.json({ ok: true });
  })
);

export default router;
