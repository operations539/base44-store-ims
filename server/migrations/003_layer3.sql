-- ============================================================
-- Layer 3  |  helper PWA, 5-stage returns, dashboards, API hub
-- ============================================================

-- Signed DC capture metadata (site-wise archive + 48h SLA clearing).
ALTER TABLE challans ADD COLUMN IF NOT EXISTS signed_dc_uploaded_at timestamptz;
ALTER TABLE challans ADD COLUMN IF NOT EXISTS signed_dc_uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Return header context: why the material came back, the SLA delay reason and
-- the closing timestamp (returns are never hard-deleted).
ALTER TABLE challans ADD COLUMN IF NOT EXISTS return_reason text;
ALTER TABLE challans ADD COLUMN IF NOT EXISTS short_missing_remarks text;
ALTER TABLE challans ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- One SLA notification per document, so the 48h scanner never repeats itself.
ALTER TABLE challans ADD COLUMN IF NOT EXISTS sla_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS challan_signed_ix ON challans (site_id, signed_dc_uploaded_at DESC);
CREATE INDEX IF NOT EXISTS challan_return_stage_ix ON challans (doc_kind, status, return_raised_at);
CREATE INDEX IF NOT EXISTS challan_sla_ix ON challans (status, created_at) WHERE sla_notified_at IS NULL;

-- ------------------------------------------------------------
-- Scoped, revocable bearer tokens for the internal REST API.
-- Only the SHA-256 hash is stored; the plaintext is shown once.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  token_prefix text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT '{}',
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_hash_ix ON api_keys (token_hash);

-- ------------------------------------------------------------
-- Default settings for the remaining admin tabs (idempotent).
-- ------------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
  ('numbering', '{"prefix_base":"KM","types":{"MRN":"MRN","PO":"PO","DC":"DC","RET":"RET","PUR":"PUR"}}'::jsonb),
  ('dc_print', '{"company_name":"Kool Mart India","address":"Kool Mart India, Pune, Maharashtra","gstin":"","footer_note":"Rate-free delivery challan. Not a tax invoice.","copies":["Store Copy","Supervisor / Porter Copy","Recipient Copy"],"show_rates":false}'::jsonb),
  ('messaging', '{"email":{"provider":"resend","from_name":"Kool Mart Store IMS","from_email":"","smtp_host":"","smtp_port":587,"smtp_user":"","smtp_secure":true,"has_password":false},"whatsapp":{"mode":"smart_link","business_number":"","api_key_configured":false},"events":{"mrn_raised":{"email":false,"whatsapp":false},"mrn_approved":{"email":false,"whatsapp":false},"po_approval":{"email":false,"whatsapp":true},"dispatch_created":{"email":false,"whatsapp":true},"return_raised":{"email":false,"whatsapp":false},"short_missing":{"email":true,"whatsapp":false},"sla_breach":{"email":true,"whatsapp":false}}}'::jsonb),
  ('erp_sync', '{"status":"inactive","hook_url":"","note":"External ERP sync is reserved for Phase 2."}'::jsonb)
ON CONFLICT (key) DO NOTHING;
