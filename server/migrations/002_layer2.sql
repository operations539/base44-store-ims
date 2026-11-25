-- ============================================================
-- Layer 2  |  operational workflow support
-- ============================================================

-- Requester remarks on an MRN (decision remarks already exist).
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS remarks text;

-- Who created each operational document (drives notifications / "my" views).
ALTER TABLE direct_pos ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE challans ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchasing_entries ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Lookups used by MRN tracking, PO links and purchase posting.
CREATE INDEX IF NOT EXISTS challan_mrn_ix ON challans (linked_mrn_id);
CREATE INDEX IF NOT EXISTS po_mrn_ix ON direct_pos (linked_mrn_id);
CREATE INDEX IF NOT EXISTS purchases_po_ix ON purchasing_entries (linked_po_id);
