# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- `artifacts/api-server` — Express API server with JWT auth, role middleware, and full CRUD endpoints.
- `artifacts/mockup-sandbox` — Canvas mockup sandbox; hosts the HOA design exploration mockups.
- `artifacts/hoa-hub` — **HOA Operations Hub** web app. Full auth UI (login page, route guards, AuthProvider). Role-based navigation: admins see all sections, managers see operational sections, residents see a minimal view.

## Authentication

- **JWT stored in HTTP-only cookie** (`auth_token`, 7-day expiry)
- **Three roles**: `admin` (full access), `manager` (operational, no settings), `resident` (limited)
- **Admin seed**: set `ADMIN_PASSWORD` env var and restart to seed `admin@quailvalleyhoa.org` via `post-merge.sh`
- **Seed script**: `artifacts/api-server/src/seed-admin.ts`
- **Middleware**: `artifacts/api-server/src/middleware/auth.ts` — `authenticateJwt`, `requireAdmin`, `requireManager`

## Database Schema (lib/db/src/schema/index.ts)

Tables: `buildings`, `units`, `work_orders`, `insurance_policies`, `documents`, `users`

The `users` table has: `id`, `email`, `password_hash` (bcrypt), `role` (admin/manager/resident), `name`, `unit_id` (for residents), `pending` (invite status), `created_at`.

## Resident Portal

Residents are redirected to `/portal` on login and cannot access the full operations hub.

- `artifacts/hoa-hub/src/pages/ResidentPortal.tsx` — unit info card, maintenance request form, own work order list, announcements placeholder
- `artifacts/hoa-hub/src/pages/ResidentDocuments.tsx` — read-only document list with download; scoped to resident's building by the API
- Route guard `ResidentRoute` in `App.tsx` enforces redirection; managers are blocked from `/portal`
- Resident sidebar: Dashboard, My Requests, Documents only (no map, insurance, settings)
- Admin Settings page supports assigning a unit to a resident (inline dropdown per user row, and unit selector on invite)

## API Routes

All routes under `/api` require JWT cookie auth except:
- `POST /api/auth/login` — public
- `GET /api/healthz` — public
- `POST /api/auth/logout` — clears cookie
- `GET /api/auth/me` — returns current user

Admin-only routes: `GET /api/users`, `POST /api/users/invite`, `PATCH /api/users/:id/role`, `PATCH /api/users/:id/unit`, `DELETE /api/users/:id`

Resident-scoped routes: `GET /api/work-orders` filters to resident's unit; `GET /api/documents` filters to resident's building.

## Site Map — Map Layers

The Site Map (`/site-map`) sidebar exposes a "Map Layers" panel (board members and admins only) with four toggles: **Buildings**, **Open work orders**, **Insurance gaps**, **Roof status**. State lives in `artifacts/hoa-hub/src/contexts/MapLayersContext.tsx` and is shared between `Layout` (checkboxes) and `SiteMap` (which passes `layers` into both `PlatMap` (Schematic SVG) and `ImageMap` (Plat/Satellite/Roadmap)). Toggle state persists across map view tab changes. When `Buildings` is off, all building-attached overlays (WO badges/dots/pins, insurance rings, roof rings) are hidden as no-ops.

## Owner-facing Board Section (Task #66)

Residents who match a unit's `ownerEmail` see a "Board" section under the
resident portal at `/portal/board` with three tabs:
- **Resolutions** — adopted resolutions flagged `public` (toggle in admin
  Resolutions page via `PATCH /api/resolutions/:id/visibility`). PDF download
  available while the resolution is in effect (not superseded/rescinded).
- **Meetings** — open + annual meetings only (executive sessions hidden).
  Detail view excludes agenda items flagged `closed_session`. Owners can post,
  edit, and delete comments on agenda items while the meeting status is
  `scheduled`. Adopted minutes and the agenda packet are downloadable.
- **Notices** — chronological feed posted automatically when a meeting is
  scheduled (`/notice`), agenda is published, minutes adopted, or a public
  resolution adopted.

Backend lives in `artifacts/api-server/src/routes/boardOwner.ts` (mounted in
`routes/index.ts` before the global JWT middleware) and helpers in
`artifacts/api-server/src/lib/governance.ts`. Notice/notification fan-out is
gated on `userIsOwner(userId)` (matches `users.email` to `units.ownerEmail`)
and `resolutions.public` for resolution-adopted events. New schema:
`resolutions.public`, `meeting_agenda_items.closed_session`,
`meeting_agenda_comments`, `notices`.

Frontend page: `artifacts/hoa-hub/src/pages/ResidentBoard.tsx` with API
client `artifacts/hoa-hub/src/lib/boardApi.ts` (direct fetch, BASE_URL).

## Amenity Inspections & Damage (Task #83)

Bookings extend through a "Used—Pending Inspection" status: the scheduler
moves `confirmed` → `used_pending_inspection` when a booking ends, and
auto-finalizes to `used` (with a `deposit_released` ledger entry) after 72
hours if no manager action. Manager UI: `Amenities` → tabs **Reservations
/ Inspections / Pool chemistry**. Resident UI: `ResidentAmenities` shows a
**Recent reservations** section with owner self-inspection, damage view,
and a dispute portal.

Schema (additive, applied via `scripts/task83.sql` from `post-merge.sh`):
- `amenity_inspection_templates` + `amenity_inspection_template_items` —
  reusable checklists. Defaults seeded by `seedDefaultInspectionTemplates`
  in `amenitiesBootstrap.ts` (clubhouse pre/post, pool_party pre/post,
  pavilion post, move_in_slot post, owner_self).
- `amenity_inspections` (kind ∈ pre/post/owner_self, status draft/submitted)
  with materialized `amenity_inspection_item_results`.
- `amenity_damage_reports` (open/charged/waived/disputed/resolved) tied to
  the booking deposit; `charge`/`waive` write to `amenity_deposit_ledger`
  (kinds: held/released/charged/refunded). A "Create work order" action
  links a damage report to a generated WO.
- `amenity_damage_disputes` — owner-filed, manager-responded.
- `pool_chemistry_logs` — daily readings; out-of-range FC/pH/alk/CYA auto-
  creates a high-priority pool work order and emails the operations group.

Backend: `routes/amenityInspections.ts` (templates, inspections, damages,
disputes, deposit ledger, pool chemistry, presigned upload URLs); email
helpers in `lib/email.ts`; lifecycle in `lib/amenityScheduler.ts`.

## Amenity Compliance & Safety Records (Task #89)

Per-amenity safety/compliance lifecycle. Status engine in
`artifacts/api-server/src/lib/amenityCompliance.ts` rolls up Green/Amber/Red
across postings (active issuance + replace-every cadence), certificates
(insurance/permits/vendor COIs with expiry), annual inspections (overdue
when last passed >365d / >Aug-15 of the year for Texas pools), and open
incidents.

Schema (additive, `lib/db/drizzle/0016_amenity_compliance.sql`):
- `amenity_required_postings` + `amenity_posting_issuances` — templated
  posters (mustache merge of `{{amenityName}}`, `{{managerName}}`,
  `{{managerPhone}}`, `{{currentDate}}`, `{{nextReplacement}}`); print
  rendering via `/amenity-postings/:id/render`.
- `amenity_certificates` — insurance / permit / vendor_coi (FK to vendors).
- `amenity_annual_inspections` (scheduled/in_progress/passed/failed/cancelled).
- `amenity_incident_reports` + `amenity_incident_attachments` +
  `amenity_incident_audit`. Major-severity incidents auto-email all
  managers/admins.
- `amenity_emergency_procedures` (singleton per amenity) +
  `amenity_safety_pins` (AED, fire extinguisher, first aid, shutoffs).

Backend: `routes/amenityCompliance.ts` (CRUD for all of the above + dashboard
summary at `/amenity-compliance/summary` and owner-visible safety summary
at `/amenities/:slug/compliance`). Scheduler hooks in
`lib/amenityScheduler.ts` notify managers ≤30d before posting/cert expiry
and on overdue incident follow-ups (audit-deduped).

UI:
- Admin: Settings → **Amenity Compliance** section
  (`components/AmenityComplianceSettings.tsx`) with tabbed drill-in for
  postings, certificates, annual inspection, incidents, emergency
  procedure, and safety pins. Issue-and-print posters in a new window;
  printable emergency procedure poster.
- Owner: `ResidentAmenities.tsx` AmenityDetail shows a redacted
  **Safety & compliance** panel (overall pill, postings list, last
  inspection date, emergency contact, on-site safety equipment).

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (runtime-managed)
- `JWT_SECRET` — secret for signing JWTs (set as a Replit Secret, not in env vars)
- `ADMIN_PASSWORD` — optional; if set, `post-merge.sh` seeds the admin user on deploy
- `SEED_DEMO_DATA` — optional; set to `1` in dev to run the demo seed via `post-merge.sh`. Never set in production.

## Demo Seed (Task #122)

Idempotent, additive demo seed that populates ~25 entity domains with realistic
data for demos and screenshots. Source: `artifacts/api-server/src/seed-demo.ts`.

Run with:

```
pnpm --filter @workspace/api-server run seed:demo
```

Or set `SEED_DEMO_DATA=1` to run automatically via `scripts/post-merge.sh`
(after the property seed). Re-running produces the same result — every row
uses a deterministic id or `seed:` marker so re-runs upsert.

### Hero unit

`B01-U01` (Dylan Taylor, 2402 Hampshire Lane) is elevated with multi-year
history: open + closed work orders (with events + attachments), 2 historical
work orders (roof 2019, plumbing 2021), ≥12 documents in the hero binder
(part of ~230 total docs across community/units/vendors), ACC requests
(current in-review + past approved), 12 months of assessments + 1 special
assessment, amenity bookings covering **all 7 statuses** plus pre/post
inspections, damage report + dispute, and a 3-row deposit ledger. EV
charging covers all 5 reservation statuses. Guest parking has a 2-night
nightly cap with patrol lookups (permitted/expired/towed/unregistered/
registered_resident). Package authorizations record proxy pickup intent.
Pet incidents (bite + off-leash) drive a suspended-pet status. The seed
also writes hearings (violation + special-assessment), notification_log
delivered records, and a fob lost-and-reissued audit note. PII is
synthetic — personas use `@quailvalleyhoa.demo` / `@example.invalid`,
phones are `+15555550XXX`. PDF storage failures are fail-loud; set
`SEED_DEMO_ALLOW_NO_STORAGE=1` to bypass for environments without
object storage.

### Personas

All seeded users share password **`Demo!2026`**.

| Email | Role | Notes |
|---|---|---|
| `demo.admin@quailvalleyhoa.demo` | admin | Board member |
| `demo.manager@quailvalleyhoa.demo` | manager | Operational |
| `demo.chair@quailvalleyhoa.demo` | manager | Board chair (President) |
| `demo.boardmember@quailvalleyhoa.demo` | manager | Treasurer |
| `demo.accountant@quailvalleyhoa.demo` | manager | Books/finance |
| `dylan.taylor49@aol.com` | resident | **Hero owner**, B01-U01, phone-verified (matches `seed-property-data.sql`) |
| `demo.owner.b01-u03@example.invalid` | resident | Owner of B01-U03 |
| `demo.tenant.b01-u03@example.invalid` | resident | Tenant of B01-U03 |
| `demo.vendor@hamptonroofing.demo` | manager | Vendor staff stand-in |

### Domains seeded

Personas, vendors (15 with COIs/W-9s/contracts), insurance policies (per
building), work orders (~80 live + ~25 historical incl. hero), bid requests
(6 across statuses), ACC requests (12), owner accounts + 12-month ledger,
governance (8 meetings, 8 motions, resolutions, committees, notices,
agenda items + hero comment), calendar (community events, trash holiday
shifts, share token), amenity bookings + lifeguard windows + blackouts +
30-day pool chemistry + expense entries, EV charging (4 ports across modes,
hero sessions), guest parking (6 permits + hero vehicle), packages (5 across
statuses) + mail hold, pets (8) + vaccinations + dog-park agreements, fobs
(60) + pool tags (20), violations (8) + compliance items (6), documents
(~46 incl. 12 hero docs with placeholder PDFs in object storage),
notifications.

To wipe seeded rows surgically: each row carries a `seed:` marker in `notes`,
`memo`, or the id itself. To full-wipe + reseed, drop the database and re-run.

## Task #75 — Calendar: Governance & Operations Integrations

Added auto-population of calendar events from existing data plus committee
sub-calendars and notice-window markers.

### Schema (lib/db/src/schema/index.ts)
Seven new tables: `committees`, `committee_members`, `election_cycles`,
`vendor_contracts`, `inspections`, `compliance_items`, `lifecycle_items`,
`vendor_certificates`. Each operational table has a `recurrence` (jsonb),
`active`/`status` flags, and FKs to existing tables (vendors, users,
buildings, calendar_sub_calendars).

### Materialization library (artifacts/api-server/src/lib/calendarMaterialize.ts)
`upsertSourceEvent` is idempotent on `(sourceRefType, sourceRefId)`. Default
sub-calendars (board / committees / operations / financial / compliance /
community / amenities / external) are created on first call. Materializers:
meeting + earliest-legal/notice-posted markers, motion deadline, resolution
"Effective", work order due-date, bid milestones (open / close / decision /
awarded), ACC decide-by, officer terms, election cycles, vendor contracts,
inspections (permit/easement folded into compliance), compliance items +
30/60/90-day reminders, lifecycle items, vendor certificates + reminders.

### Routes
New: `committees`, `electionCycles`, `inspections`, `complianceItems`,
`lifecycleItems`, `vendorContracts`, `vendorCertificates` (all CRUD with
materialization hooks). Mounted in `routes/index.ts`.

Hooks added to existing routes: meetings (POST/PATCH/DELETE/notice),
motions (open/withdraw/maybeFinalize), `lib/resolutions.ts`
(`onResolutionMotionAdopted`), workOrders (POST/PATCH/DELETE), bids
(POST/PATCH/award/cancel), architecturalRequests (POST + decide
transitions), auth.ts (board-member + officer-term PATCH).

### UI
Settings page gains a **Committees** section with create/list/archive
controls. Frontend uses raw `fetch` against `/api/committees` (no codegen
update needed).

### DB migration note
Branch DB was missing migrations 0009–0013; drizzle-kit push is interactive
and could not be driven non-interactively. Applied the missing migration SQL
plus the 8 new task-#75 tables directly via raw SQL. drizzle-kit migrations
journal is **not** updated — a follow-up task should generate a single
`0014_task75_calendar_integrations` migration once drizzle-kit can be run
interactively.

## Task #84 — Amenity Guest Parking & Vehicle Registry
Per-unit nightly guest-parking permits with eligibility gates, sequential
year-prefixed numbering (`GP-YYYY-NNNN`), printable HTML permit + QR,
public digital pass at `/api/permit/:token` (signed token, no auth),
patrol parking lookup, and towable CSV export.

### Tables (raw SQL applied; drizzle-kit migrations journal NOT updated)
`guest_parking_permits`, `guest_parking_settings`, `guest_parking_lookups`.

### Lib & routes
- `artifacts/api-server/src/lib/guestParking.ts`: settings, eligibility
  (cap/dates/account-current/violations/registry), allocate-with-advisory-lock
  numbering, QR token sign/verify, HTML permit + digital-pass renderers,
  audit (via `amenity_access_audit` with `providerKind=guest_parking`).
- `artifacts/api-server/src/routes/guestParking.ts`: settings GET/PUT,
  eligibility-preview, list (me/manager), create, modify, cancel,
  permit.html, qr.svg, public `/permit/:token`, `/patrol/parking?q=`,
  `/guest-parking/towable.csv`, `/guest-parking/lookups`.
- Wired into `routes/index.ts` — public router registered before auth
  middleware so `/api/permit/:token` is reachable unauthenticated.

### UI
- New `pages/ParkingPermits.tsx` (resident + manager views, modal wizard
  with live eligibility preview).
- `App.tsx` routes: `/parking` (manager) and `/portal/parking` (resident).
- Layout sidebar gains a **Guest Parking** link for residents.
- `Patrol.tsx` extended with a parking-lookup section showing valid /
  registered-resident / expired / cancelled / unregistered (towable) status.

Front-end uses `apiFetch` (no OpenAPI codegen update).

## Task #88 — Amenity Financials & Reporting

Reporting layer over existing amenity / charging / ledger data (not a GL system).

**Backend** (`artifacts/api-server/src/lib/amenityFinancials.ts`,
`routes/amenityFinancials.ts`, mounted in `routes/index.ts`):
- `GET /api/reports/amenities/revenue(.csv)` — KPIs, revenue mix by kind, by
  amenity, by month, optional `compare=prior_period|prior_year|both`.
- `GET /api/reports/amenities/utilization` — weekday × hour heat-map cells.
- `GET /api/reports/amenities/deposits(.csv)` — held / released / forfeited /
  refunded balances, held-deposit list with age, recent ledger entries,
  stuck-deposit count.
- `POST /api/reports/amenities/refunds` — refund engine. Source booking or
  charging session. Posts an `amenity_refund` credit to the ledger gated by
  `organization_settings.expenditure_threshold_cents` unless
  `approveAboveThreshold` (admin-only).
- `GET/POST/DELETE /api/reports/amenities/expenses` — per-amenity expense log
  (`amenity_expense_entries` table, schema added at end of `lib/db/src/schema/index.ts`).
- `GET /api/reports/amenities/pnl` — net revenue – expenses per amenity.
- `GET /api/reports/amenities/alerts` — refund-rate, stuck-deposits,
  utilization-floor warnings.
- `GET /api/reports/amenities/monthly-summary` — printable HTML month-end PDF
  (browser print to PDF).
- `GET /api/me/amenity-usage(.csv)` and
  `GET /api/users/:userId/amenity-usage` — per-owner history.

Permissions:
- `requireFinanceRead`: manager | admin | board member.
- `requireFinanceWrite` (refunds, expenses): manager | admin.
- `/me/amenity-usage`: any authenticated owner.

Schema: added `amenity_expense_entries` table; added missing columns
`source_motion_id`, `emergency_bypass_id` on `ledger_entries` to match
existing schema.

**Frontend**:
- `artifacts/hoa-hub/src/pages/AmenityFinancials.tsx` — tabbed dashboard
  (Revenue / Utilization / Deposits / P&L / Expenses / Alerts) with 30d/90d/
  YTD/12m/custom range, amenity filter, prior-period & YoY compare toggle,
  CSV / month-end PDF export, refund + expense dialogs.
- Route `/reports/amenities` registered in `App.tsx`; sidebar link in
  `Layout.tsx` gated by `isManager || !!user?.boardMember`.
- `MyAccount.tsx` gains an **Amenity usage** card (booking history with
  fees, deposits, refunds, net) plus CSV download.
- All new frontend calls use `apiFetch`; no OpenAPI codegen change.

## Task #121 — OCR & auto-tag suggestions for the bulk historical-document importer

**Backend (`artifacts/api-server`)**
- `lib/ocrHeuristics.ts` — pure heuristics for category / document date / vendor /
  building / unit suggestions, each returning `{ value, confidence, snippet }`.
  Vendor uses fuzzy substring against the vendors table; building uses bldg-NN
  patterns; unit uses contextual “Unit 12B” regex. Covered by
  `ocrHeuristics.test.ts`.
- `lib/ocrProvider.ts` — runtime text-extractor. Plain `text/*` is passed
  through; PDFs first try `pdf-parse` for native embedded text + page count,
  and when the result looks scanned (< 60 chars/page) fall back to OpenAI's
  Responses API with `input_file` for true OCR. Images go straight to
  vision via chat/completions (`gpt-5-mini`).
  Returns `null` (job marked `skipped`) when no key is configured so prod
  never breaks waiting on credentials.
- `lib/ocrSchedulerLogic.ts` + `lib/ocrScheduler.ts` — async job queue. Pure
  decision helpers (`applyOrgGate`, `pickNextWithCap`, `shouldRetryOrFail`)
  live in the logic module and are unit-tested in `ocrScheduler.test.ts`. The
  runtime scheduler ticks every 5s with `MAX_PARALLEL=2`, `MAX_ATTEMPTS=3`,
  enforces the org `ocrEnabled` toggle and `ocrDailyPageCap`
  (sum(pageCount) since UTC midnight), and exports `enqueueOcrJob`,
  `getOcrJobsByStorageKeys`, `startOcrScheduler` (wired in `index.ts`).
- `routes/documents.ts` — the importer preview hydrates `row.ocr` from the
  jobs table and **auto-applies** completed suggestions (confidence ≥ 0.5)
  to fields the manager hasn't supplied per-file (category, date, building,
  unit, vendorId). The preview enqueues jobs gated by the org toggle AND
  `body.skipOcr` and returns `ocrEnabled`. Search includes `extractedText`.
  Commit persists vendorId + already-completed text; the scheduler
  back-fills late completions onto `documents` by `storage_key`.
- `routes/settings.ts` — `toOrgSettings` exposes `ocrEnabled` /
  `ocrDailyPageCap` (read). Mutation lives on a dedicated admin-only
  endpoint `PATCH /settings/ocr` (gated by `requireAdmin`); the general
  `PATCH /settings` strips OCR fields if any are sent.
- `lib/ocrScheduler.ts` — wave-based parallelism (MAX_PARALLEL=2) with
  Promise.all per wave, mid-flight `pagesProcessedToday()` check between
  waves so the daily cap is honoured even on long batches, and exponential
  retry backoff keyed on `attempts` + `startedAt` (30s after attempt 1, 2m
  after attempt 2). Retry/backoff helpers extracted to `ocrSchedulerLogic.ts`
  and unit-tested.
- Schema: `documentsTable.extractedText`, `organization_settings.ocrEnabled`
  (default true) + `ocrDailyPageCap` (default 1000), and a new
  `documentOcrJobsTable` (storage_key unique, status
  queued|processing|completed|failed|skipped, suggestions jsonb, fullText,
  pageCount, attempts). Migration `lib/db/drizzle/0018_ocr_auto_tag.sql`,
  applied directly via psql.

**Frontend (`artifacts/hoa-hub`)**
- `components/BulkImportDialog.tsx` — per-batch **Skip OCR** toggle, OCR
  status pill in the preview header, and a per-row review table with
  inline editors for category / building / unit / document date. Each row
  shows an "OCR evidence" panel listing every suggested field with a
  per-field confidence pill (high/med/low colour bands), the source
  snippet, and a marker indicating whether the suggestion was auto-applied
  or manually overridden. Manual edits flow back through the next preview
  round-trip via `files[].category|building|unit|documentDate` overrides
  and survive on commit, so manager review/correction is always honoured
  over the OCR suggestion. The dialog passes `contentType` for every
  staged file so the scheduler can dispatch the right extractor, and polls
  `/documents/import-batches/preview` every 2s while any row is still
  queued/processing.
- `pages/Settings.tsx` — Organization section gains an admin-only **OCR
  auto-tag suggestions** panel with on/off + daily page cap, persisted via
  `PATCH /settings/ocr`.

**API spec** — `lib/api-spec/openapi.yaml`: new `OcrSuggestion`/`OcrRowState`
schemas, `ocr` field on `ImportBatchPreviewRow`, `skipOcr` on
`ImportBatchPreviewBody`, `ocrEnabled` on the preview response, a
`PATCH /settings/ocr` admin path with `UpdateOcrSettingsBody`, and
`ocrEnabled`/`ocrDailyPageCap` on settings. Codegen regenerated.
