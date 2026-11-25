# KoolMart Store IMS

Store inventory, dispatch and site material control for **Kool Mart India**.

Responsive desktop console + mobile PWA for warehouse and site teams: a two-ledger
stock system, rate-free delivery challans, five-stage return tracking, strict
role-based access and an append-only audit trail.

## Stack

| Layer | Choice |
| --- | --- |
| Web | React 18 + Vite 6 (dev server on port 3000, `/api` proxied to the API) |
| API | Node 22 + Express 4, raw SQL through `pg` |
| DB | PostgreSQL 16 |
| Auth | Email/username + password (bcrypt), Google OAuth, server-side sessions |

The SPA and the API share one origin, so the session cookie is same-site and no CORS
configuration is needed.

## Run locally

```bash
docker compose up -d          # db → migrate+seed → api → web
open http://localhost:3000
```

Migrations live in `server/migrations` and run at API startup (`node src/migrate.js`)
together with the idempotent demo seed, so no one-shot container exits under the
health checker. `schema_migrations` records what has run.

## Demo logins (Layer 1 seed)

Every seeded record is tagged `is_demo = true`, including the demo users. The
administrator account is **not** demo, so a demo reset never locks you out.

| Email | Person | Role |
| --- | --- | --- |
| `aniket@koolmart.in` | Aniket Deshpande | MIS & System Builder (admin) |
| `parul@koolmart.in` | Parul Kool | Owners & VP (read-only) |
| `arun@koolmart.in` | Arun Nair | Store Manager |
| `prashant@koolmart.in` | Prashant Jadhav | Store Executive |
| `ravi@koolmart.in` | Ravi Kumar | Store Helper (mobile, 2 tabs) |
| `suresh@koolmart.in` | Suresh Patil | Site Supervisor (mobile, 3 tabs) |

Shared password: `Koolmart@123`. The sign-in screen lists them and fills the form on
click.

## Domain model

Eight core tables:

`items_master`, `sites_master`, `vendors_master`, `material_requests`, `direct_pos`,
`challans`, `challan_lines`, `purchasing_entries`

plus `users`, `audit_logs`, `notifications`, `message_logs` and four supporting tables:

- `stock_movements` — immutable store-stock ledger. `items_master.store_physical_stock`
  is a cached balance recomputed from it in the same transaction, and it may go
  negative (minus-stock override) by design.
- `document_sequences` — concurrency-safe `KM/<FY>/<DOC>/<MM>/<SEQ>` allocation
  (April–March financial year).
- `sessions`, `app_settings`.

`v_site_material_ledger` is the derived site side of the two-ledger system: issued
quantity from outward challans minus returned quantity once material has physically
left the site.

`audit_logs` has a database trigger: `UPDATE` always fails, and `DELETE` fails unless
the row is tagged `is_demo = true`. Audit rows are not foreign-keyed to users, so
removing a user can never rewrite history.

## Access model

Six roles, enforced on every API route (`server/src/rbac.js`) — hiding a menu is only
cosmetic:

| Role | Summary |
| --- | --- |
| `admin` | Everything, admin panel, CSV import, demo reset, emulation |
| `owner` | Read-only dashboards, stock, masters, audit; no writes |
| `store_manager` | MRN approval, PO create/approve, dispatch, returns inspection |
| `store_exec` | PO, challan, purchasing entries, pickup/receipt stages |
| `store_helper` | Price-free packing lists + signed DC upload (2 mobile tabs) |
| `supervisor` | Raise MRN/returns, tracking, assigned sites only (3 mobile tabs) |

Pricing columns are never selected for roles without `stock.price.read`, so rates are
absent from the JSON — not just hidden in the UI.

Administrators can **Login as** any non-admin user. The session keeps the real admin
identity, a persistent banner is shown, and every audit entry records both the actor
and the effective user.

## Useful commands

```bash
# inside the api container
node src/migrate.js          # apply pending migrations
node src/seed.js             # seed demo data (idempotent)

# tests / lint are not set up yet; verify with
curl -s localhost:3000/api/health
```

## Layer status

Layer 1: schema, auth + RBAC, shells, admin panel, demo seed.

Layer 2: core operational workflows.

| Screen | What it does |
| --- | --- |
| Material Requests (`/mrn`) | Raise MRN (site-scoped, no rates), approval queue, split-panel approve / part-approve / reject with live store stock, item-wise dispatched vs remaining, linked PO + challan summary |
| Direct POs (`/pos`) | Auto `KM/<FY>/PO/<MM>/<seq>`, vendor address & GSTIN auto-fill, fixed terms, optional approvers, ₹0 rate and pending bill never block, A4 print + WhatsApp share |
| Dispatch Challans (`/challans`) | Auto DC numbers, backdated flag, three flows (Full Store / Split / Direct-to-Site), optional linked MRN, multi-challan partial fulfilment, minus-stock override with audit entry, 3-copy rate-free A4 print |
| Store Purchasing (`/purchasing`) | Receipt linked to a Direct PO, adds stock (clears minus stock), serials, pending bill + rate 0, bill photo upload, later bill/rate edit |
| Site Material Ledger (`/site-ledger`) | Derived issued / returned / net at site, quantities only |

Dispatch math is atomic inside one transaction: store-sourced lines write a signed
`stock_movements` row and recompute `items_master.store_physical_stock`; vendor lines
write none. The MRN status is then derived from the dispatch ledger
(`Approved → Partial → Fulfilled`), and the supervisor stage adds
`Dispatched / Delivered / Returned` from the linked challans.

Bill photos upload to the API (`POST /api/files`, JPG/PNG/WEBP up to 4 MB) and are
served only to signed-in users through `GET /api/files/:name`.

Layer 3 (this build): field app, returns gate, executive views and the API hub.

| Screen | What it does |
| --- | --- |
| Helper PWA (`/m/packing`, `/m/scan`) | Two tabs only, zero pricing: approved packing lists with site/transport details, 1-tap signed-DC capture that marks the challan Delivered-Signed, clears the 48-hour alert and files the photo in the site gallery with a share link |
| Material Returns (`/returns`, `/m/returns/new`) | Five stages — raised, pickup assigned, picked up, store received, system posted. Usable adds back to store stock, scrap only raises the scrap bucket, short/missing needs remarks and flags Owners & VP. Sent = usable + scrap + short is enforced per line; >48h needs a delay reason; vendor returns need a signed return DC |
| Executive dashboards (`/`) | Overview plus five live tabs — MRN-to-delivery, challan status & signed-DC archive, returns & 48-hr SLA, stock & site ledger, scrap & pending bills — each with CSV and PDF export and role-scoped quick actions |
| Admin (`/admin/documents`, `/admin/messaging`, `/admin/api`) | FY numbering prefixes, fixed PO terms, rate-free 3-copy DC header; email/WhatsApp settings with event toggles and a retryable send log; scoped revocable API keys with documented internal REST endpoints |
| Internal API (`/api/v1`) | Bearer tokens (SHA-256 hashed), scopes for stock, MRNs, dispatch and masters; every write is audit-logged. External ERP sync stays inactive in Phase 1 |

A background scanner runs every five minutes and raises the 48-hour SLA flags for
unsigned challans and unclosed returns, notifying the responsible roles once.

Still reserved: WhatsApp Business API sending (Phase 2), external ERP sync, and
Google OAuth until `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set.

Google OAuth is wired but inactive until `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are present in the environment.
