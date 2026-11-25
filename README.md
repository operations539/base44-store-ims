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

Migrations live in `server/migrations` and are applied by the `migrate` service, which
also seeds the demo dataset and then exits. `schema_migrations` records what has run.

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

Layer 1 (this build): schema, auth + RBAC, shells, admin panel, demo seed.

Not yet built: MRN approval, Direct PO, the three dispatch scenarios, signed-DC
capture, the five executive dashboards, messaging/API hub (Layers 2–3).

Google OAuth is wired but inactive until `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are present in the environment.
