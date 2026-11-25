-- ============================================================
-- KoolMart Store IMS  |  Layer 1 foundation schema
-- 8 core tables + users, audit_logs, notifications, message_logs
-- + supporting ledger / sequence / session / settings tables
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Users & sessions
-- ------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  username        text UNIQUE,
  password_hash   text,
  full_name       text NOT NULL,
  role            text NOT NULL CHECK (role IN
                    ('admin','owner','store_manager','store_exec','store_helper','supervisor')),
  employee_id     text,
  department_code text CHECK (department_code IS NULL OR department_code IN
                    ('MIS','SLS','DSN','PRJ','STR','SRV','ACC','HR')),
  phone           text,
  google_sub      text UNIQUE,
  is_active       boolean NOT NULL DEFAULT true,
  is_demo         boolean NOT NULL DEFAULT false,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_ux ON users (lower(email));
CREATE INDEX users_role_ix ON users (role);

CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        text NOT NULL UNIQUE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emulated_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  ip                text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL
);
CREATE INDEX sessions_user_ix ON sessions (user_id);

-- ------------------------------------------------------------
-- 1. Items_Master
-- ------------------------------------------------------------
CREATE TABLE items_master (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code             text NOT NULL UNIQUE,
  category              text NOT NULL CHECK (category IN ('High Side','Low Side')),
  prod_category         text,
  item_name             text NOT NULL,
  model_no              text,
  unit                  text NOT NULL CHECK (unit IN
                          ('nos','pcs','feet','mtr','sqft','kg','roll','box')),
  tax_percent           numeric(5,2) NOT NULL DEFAULT 18
                          CHECK (tax_percent IN (0,5,12,18,28)),
  -- SIGNED quantity: negative balances are legal (minus-stock override)
  store_physical_stock  numeric(14,3) NOT NULL DEFAULT 0,
  min_qty_alert         numeric(14,3) NOT NULL DEFAULT 0,
  scrap_qty             numeric(14,3) NOT NULL DEFAULT 0,
  latest_rate           numeric(14,2) NOT NULL DEFAULT 0 CHECK (latest_rate >= 0),
  is_demo               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_category_ix ON items_master (category);
CREATE INDEX items_name_ix ON items_master (lower(item_name));

-- ------------------------------------------------------------
-- 2. Sites_Master
-- ------------------------------------------------------------
CREATE TABLE sites_master (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_project_id         text NOT NULL UNIQUE,
  client_project_name     text NOT NULL,
  full_site_address       text,
  assigned_supervisor_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Closed')),
  is_demo                 boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_supervisor_ix ON sites_master (assigned_supervisor_id);

-- ------------------------------------------------------------
-- 3. Vendors_Master
-- ------------------------------------------------------------
CREATE TABLE vendors_master (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        text NOT NULL UNIQUE,
  vendor_name      text NOT NULL,
  full_address     text,
  gstin            text,
  contact_persons  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendors_name_ix ON vendors_master (lower(vendor_name));

-- ------------------------------------------------------------
-- 4. Material_Requests (MRN)
-- ------------------------------------------------------------
CREATE TABLE material_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn_no             text NOT NULL UNIQUE,
  mrn_date           date NOT NULL DEFAULT CURRENT_DATE,
  site_id            uuid NOT NULL REFERENCES sites_master(id) ON DELETE RESTRICT,
  requested_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  required_date      date,
  priority           text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','Urgent')),
  status             text NOT NULL DEFAULT 'Pending'
                       CHECK (status IN ('Pending','Approved','Partial','Fulfilled','Rejected')),
  routing_type       text CHECK (routing_type IS NULL OR routing_type IN
                       ('Full Store','Split','Direct-to-Site')),
  line_items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_department  text NOT NULL DEFAULT 'PRJ' CHECK (source_department IN
                       ('SLS','DSN','PRJ','STR','SRV','ACC','HR')),
  external_ref_id    text,
  decision_remarks   text,
  decided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mrn_site_ix ON material_requests (site_id);
CREATE INDEX mrn_status_ix ON material_requests (status);
CREATE INDEX mrn_date_ix ON material_requests (mrn_date DESC);

-- ------------------------------------------------------------
-- 5. Direct_POs
-- ------------------------------------------------------------
CREATE TABLE direct_pos (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_code                       text NOT NULL UNIQUE,
  po_date                       date NOT NULL DEFAULT CURRENT_DATE,
  vendor_id                     uuid NOT NULL REFERENCES vendors_master(id) ON DELETE RESTRICT,
  linked_mrn_id                 uuid REFERENCES material_requests(id) ON DELETE SET NULL,
  delivery_location_type        text NOT NULL DEFAULT 'Store' CHECK (delivery_location_type IN ('Store','Site')),
  delivery_site_id              uuid REFERENCES sites_master(id) ON DELETE SET NULL,
  auto_vendor_address           text,
  terms_conditions              text,
  approval_required             boolean NOT NULL DEFAULT false,
  approver_ids                  uuid[] NOT NULL DEFAULT '{}',
  approval_status               text NOT NULL DEFAULT 'Not Required'
                                  CHECK (approval_status IN ('Not Required','Pending','Approved','Rejected')),
  approved_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at                   timestamptz,
  approval_remarks              text,
  line_items                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                        text NOT NULL DEFAULT 'Issued'
                                  CHECK (status IN ('Pending Approval','Issued','Sent','Closed','Cancelled')),
  pdf_link                      text,
  sent_via                      text CHECK (sent_via IS NULL OR sent_via IN ('Email','WhatsApp')),
  sent_at                       timestamptz,
  source_department             text NOT NULL DEFAULT 'STR' CHECK (source_department IN
                                  ('SLS','DSN','PRJ','STR','SRV','ACC','HR')),
  external_ref_id               text,
  account_verification_status   text NOT NULL DEFAULT 'Pending'
                                  CHECK (account_verification_status IN ('Pending','Verified','Rejected')),
  erp_sync_status               text NOT NULL DEFAULT 'Pending'
                                  CHECK (erp_sync_status IN ('Pending','Synced','Failed')),
  erp_voucher_ref               text,
  is_demo                       boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX po_vendor_ix ON direct_pos (vendor_id);
CREATE INDEX po_status_ix ON direct_pos (status);

-- ------------------------------------------------------------
-- 6. Challans (outward DCs and returns share this header)
-- ------------------------------------------------------------
CREATE TABLE challans (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_code                text NOT NULL UNIQUE,
  doc_kind                    text NOT NULL DEFAULT 'DC' CHECK (doc_kind IN ('DC','RET')),
  challan_date                date NOT NULL DEFAULT CURRENT_DATE,
  backdated_flag              boolean NOT NULL DEFAULT false,
  linked_mrn_id               uuid REFERENCES material_requests(id) ON DELETE SET NULL,
  linked_po_id                uuid REFERENCES direct_pos(id) ON DELETE SET NULL,
  site_id                     uuid REFERENCES sites_master(id) ON DELETE RESTRICT,
  vendor_id                   uuid REFERENCES vendors_master(id) ON DELETE SET NULL,
  flow_type                   text NOT NULL CHECK (flow_type IN
                                ('Full Store','Split','Direct Vendor','Return Store','Return Vendor')),
  vendor_physical_dc_no       text,
  transport_mode              text CHECK (transport_mode IS NULL OR transport_mode IN
                                ('Internal EECO','Third-Party Porter','Vendor Direct','Field Staff')),
  driver_delivery_person_name text,
  driver_phone                text,
  vehicle_no                  text,
  header_remarks              text,
  status                      text NOT NULL DEFAULT 'Issued' CHECK (status IN
                                ('Issued','Delivered-Signed','Closed','Return Raised',
                                 'Pickup Assigned','Picked Up','Store Received','Cancelled')),
  signed_dc_photo_url         text,
  site_share_link             text UNIQUE,
  sla_48h_breach_flag         boolean NOT NULL DEFAULT false,
  delay_reason                text,
  override_minus_stock_flag   boolean NOT NULL DEFAULT false,
  source_department           text NOT NULL DEFAULT 'STR' CHECK (source_department IN
                                ('SLS','DSN','PRJ','STR','SRV','ACC','HR')),
  external_ref_id             text,
  account_verification_status text NOT NULL DEFAULT 'Pending'
                                CHECK (account_verification_status IN ('Pending','Verified','Rejected')),
  erp_sync_status             text NOT NULL DEFAULT 'Pending'
                                CHECK (erp_sync_status IN ('Pending','Synced','Failed')),
  erp_voucher_ref             text,
  -- 5-stage return tracking (anti-leakage)
  return_raised_at            timestamptz,
  pickup_assigned_at          timestamptz,
  picked_up_at                timestamptz,
  store_received_at           timestamptz,
  system_posted_at            timestamptz,
  received_photo_url          text,
  signed_return_dc_photo_url  text,
  short_missing_flagged       boolean NOT NULL DEFAULT false,
  is_demo                     boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX challan_site_ix ON challans (site_id);
CREATE INDEX challan_status_ix ON challans (status);
CREATE INDEX challan_flow_ix ON challans (flow_type);
CREATE INDEX challan_date_ix ON challans (challan_date DESC);

-- ------------------------------------------------------------
-- 7. Challan_Lines
-- ------------------------------------------------------------
CREATE TABLE challan_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id            uuid NOT NULL REFERENCES challans(id) ON DELETE CASCADE,
  line_no               integer NOT NULL DEFAULT 1,
  item_id               uuid NOT NULL REFERENCES items_master(id) ON DELETE RESTRICT,
  qty                   numeric(14,3) NOT NULL CHECK (qty > 0),
  unit                  text NOT NULL,
  line_source           text NOT NULL DEFAULT 'Store' CHECK (line_source IN ('Store','Vendor')),
  serial_nos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  return_condition      text CHECK (return_condition IS NULL OR return_condition IN ('Usable','Scrap')),
  inspection_remarks    text,
  -- return reconciliation (Sent = Usable + Scrap + Short/Missing)
  received_usable_qty   numeric(14,3),
  received_scrap_qty    numeric(14,3),
  short_missing_qty     numeric(14,3),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challan_lines_reconcile_chk CHECK (
    received_usable_qty IS NULL
    OR (received_scrap_qty IS NOT NULL AND short_missing_qty IS NOT NULL
        AND received_usable_qty >= 0 AND received_scrap_qty >= 0 AND short_missing_qty >= 0
        AND received_usable_qty + received_scrap_qty + short_missing_qty = qty)
  )
);
CREATE INDEX challan_lines_challan_ix ON challan_lines (challan_id);
CREATE INDEX challan_lines_item_ix ON challan_lines (item_id);

-- ------------------------------------------------------------
-- 8. Purchasing_Entries
-- ------------------------------------------------------------
CREATE TABLE purchasing_entries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id                 text NOT NULL UNIQUE,
  entry_date                  date NOT NULL DEFAULT CURRENT_DATE,
  linked_po_id                uuid REFERENCES direct_pos(id) ON DELETE SET NULL,
  vendor_id                   uuid NOT NULL REFERENCES vendors_master(id) ON DELETE RESTRICT,
  item_id                     uuid NOT NULL REFERENCES items_master(id) ON DELETE RESTRICT,
  qty                         numeric(14,3) NOT NULL CHECK (qty > 0),
  high_side_serial_nos        jsonb NOT NULL DEFAULT '[]'::jsonb,
  bill_status                 text NOT NULL DEFAULT 'Pending' CHECK (bill_status IN ('Received','Pending')),
  bill_no                     text,
  rate                        numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  tax_percent                 numeric(5,2) NOT NULL DEFAULT 18,
  total_amount                numeric(14,2) NOT NULL DEFAULT 0,
  bill_photo_url              text,
  account_verification_status text NOT NULL DEFAULT 'Pending'
                                CHECK (account_verification_status IN ('Pending','Verified','Rejected')),
  erp_sync_status             text NOT NULL DEFAULT 'Pending'
                                CHECK (erp_sync_status IN ('Pending','Synced','Failed')),
  erp_voucher_ref             text,
  is_demo                     boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_vendor_ix ON purchasing_entries (vendor_id);
CREATE INDEX purchases_item_ix ON purchasing_entries (item_id);
CREATE INDEX purchases_bill_ix ON purchasing_entries (bill_status);

-- ------------------------------------------------------------
-- Immutable stock ledger (drives Items_Master balances)
-- ------------------------------------------------------------
CREATE TABLE stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES items_master(id) ON DELETE RESTRICT,
  qty             numeric(14,3) NOT NULL DEFAULT 0,  -- signed store-stock delta
  scrap_qty_delta numeric(14,3) NOT NULL DEFAULT 0,  -- scrap bucket delta
  unit            text,
  movement_type   text NOT NULL CHECK (movement_type IN
                    ('opening','purchase','challan_out','return_usable','return_scrap','adjustment')),
  ref_type        text,
  ref_id          uuid,
  ref_no          text,
  notes           text,
  idempotency_key text UNIQUE,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_ix ON stock_movements (item_id, created_at);
CREATE INDEX stock_movements_ref_ix ON stock_movements (ref_type, ref_id);

-- ------------------------------------------------------------
-- Audit / notifications / messages
-- ------------------------------------------------------------
-- Audit history is deliberately NOT foreign-keyed to users: a deleted user must
-- never mutate (or block) an append-only audit row.
CREATE TABLE audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts                timestamptz NOT NULL DEFAULT now(),
  actor_user_id     uuid,
  actor_role        text,
  effective_user_id uuid,
  emulated          boolean NOT NULL DEFAULT false,
  module            text NOT NULL,
  record_type       text,
  record_id         text,
  action            text NOT NULL,
  old_values        jsonb,
  new_values        jsonb,
  remarks           text,
  ip                text,
  is_demo           boolean NOT NULL DEFAULT false
);
CREATE INDEX audit_ts_ix ON audit_logs (ts DESC);
CREATE INDEX audit_module_ix ON audit_logs (module);
CREATE INDEX audit_record_ix ON audit_logs (record_type, record_id);

CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.is_demo = false THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  is_read     boolean NOT NULL DEFAULT false,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_ix ON notifications (user_id, is_read);

CREATE TABLE message_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL CHECK (channel IN ('email','whatsapp')),
  event_key     text NOT NULL,
  recipient     text,
  subject       text,
  body          text,
  status        text NOT NULL DEFAULT 'Queued' CHECK (status IN ('Queued','Sent','Failed')),
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  related_type  text,
  related_id    text,
  sent_at       timestamptz,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_logs_status_ix ON message_logs (status);

-- ------------------------------------------------------------
-- Supporting: document sequences & settings
-- ------------------------------------------------------------
CREATE TABLE document_sequences (
  doc_type    text NOT NULL,
  fy          text NOT NULL,
  month       integer NOT NULL,
  last_value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, fy, month)
);

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER items_touch BEFORE UPDATE ON items_master FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sites_touch BEFORE UPDATE ON sites_master FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vendors_touch BEFORE UPDATE ON vendors_master FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER mrn_touch BEFORE UPDATE ON material_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER po_touch BEFORE UPDATE ON direct_pos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER challans_touch BEFORE UPDATE ON challans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER purchases_touch BEFORE UPDATE ON purchasing_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Derived site material ledger (2-ledger system, site side)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_site_material_ledger AS
WITH outbound AS (
  SELECT c.site_id, cl.item_id, SUM(cl.qty) AS qty
  FROM challans c
  JOIN challan_lines cl ON cl.challan_id = c.id
  WHERE c.flow_type IN ('Full Store','Split','Direct Vendor')
    AND c.status <> 'Cancelled'
  GROUP BY c.site_id, cl.item_id
), inbound AS (
  SELECT c.site_id, cl.item_id,
         SUM(COALESCE(cl.received_usable_qty,0) + COALESCE(cl.received_scrap_qty,0)) AS qty
  FROM challans c
  JOIN challan_lines cl ON cl.challan_id = c.id
  WHERE c.flow_type IN ('Return Store','Return Vendor')
    AND c.picked_up_at IS NOT NULL
    AND c.status <> 'Cancelled'
  GROUP BY c.site_id, cl.item_id
)
SELECT COALESCE(o.site_id, i.site_id)        AS site_id,
       COALESCE(o.item_id, i.item_id)        AS item_id,
       COALESCE(o.qty, 0)                    AS issued_qty,
       COALESCE(i.qty, 0)                    AS returned_qty,
       COALESCE(o.qty, 0) - COALESCE(i.qty, 0) AS net_qty
FROM outbound o
FULL JOIN inbound i ON i.site_id = o.site_id AND i.item_id = o.item_id;
