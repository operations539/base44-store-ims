-- ============================================================
-- Guard: a database that recorded 003 before the SLA column was
-- added would never create it, breaking the 48-hour scanner.
-- Idempotent, so this is a no-op on fresh installs.
-- ============================================================
ALTER TABLE challans ADD COLUMN IF NOT EXISTS sla_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS challan_sla_ix ON challans (status, created_at) WHERE sla_notified_at IS NULL;
