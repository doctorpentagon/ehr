# Awibi EHR — Technical Documentation

> Mobile-first Electronic Health Records platform for Nigerian healthcare facilities. NDPA 2023 compliant.

**Stack:** React 18 · Vite 5 · Node.js · Express · Prisma · Supabase PostgreSQL · JWT · Google OAuth · Paystack

---

## Table of Contents

1. [Architecture](#architecture)
2. [Services & Ports](#services--ports)
3. [Prerequisites](#prerequisites)
4. [Manual Setup Steps](#manual-setup-steps)
5. [First Run](#first-run)
6. [Demo Credentials](#demo-credentials)
7. [Auth Flows](#auth-flows)
8. [Google OAuth](#google-oauth)
9. [RBAC Roles & Permissions](#rbac-roles--permissions)
10. [Environment Variables](#environment-variables)
11. [Database Schema](#database-schema)
12. [API Reference](#api-reference)
13. [NIN Verification](#nin-verification)
14. [Security](#security)
15. [Production Checklist](#production-checklist)
16. [Hosting Options](#hosting-options)

---

## Architecture

Awibi EHR is a **multi-service monorepo**. Three independent services communicate over HTTP. The frontend proxies all `/v1/*` requests to the EHR Backend via Vite's dev server — no CORS configuration needed in development.

```
Browser (5177)
   │
   ├─ /v1/* → EHR Backend (8000) ─── Supabase DB (sgdmiwfvqwgxzhnwekul)
   │                │
   │                └─ server-to-server → Identity Backend (8001) ─── Supabase DB (doteitlmckzcqcijtvdv)
   │
   └─ Direct → Landing Page (5176)

Identity Frontend (5178) → Identity Backend (8001)
```

---

## Services & Ports

| Service | Folder | Port | Tech |
|---------|--------|------|------|
| **EHR Backend** | `Awibi-EHR-Backend/` | **8000** | Node.js · Express · Prisma · Supabase |
| **Identity Backend** | `Awibi-Identity-Backend/` | **8001** | Node.js · Express · Prisma · Supabase |
| **EHR Frontend** | `Awibi-EHR-Frontend/` | **5177** | React 18 · Vite 5 · Tailwind · Redux · Zustand |
| **Identity Frontend** | `Awibi-Identity-Frontend/` | **5178** | React 18 · Vite 5 · Tailwind |
| **Landing Page** | `Awibi-EHR-Landing-main/` | **5176** | React 18 · Vite 5 · Tailwind |

- Swagger UI (dev only): `http://localhost:8000/api-docs`
- EHR health: `http://localhost:8000/v1/health`
- Identity health: `http://localhost:8001/healthz`

---

## Prerequisites

- Node.js ≥ 18 · npm ≥ 9
- Active [Supabase](https://app.supabase.com) account (2 projects, one per backend)
- Google Cloud Console account (for Google OAuth)
- Gmail account with App Password enabled
- Cloudinary account (for file/photo uploads)
- Paystack account (test keys already in `.env`)

---

## Manual Setup Steps

> These cannot be automated. Complete all steps before first run.

### 1. Restore Supabase Projects (if paused)

Free-tier Supabase projects auto-pause after 1 week of inactivity. Symptoms: `P1001: Can't reach database`.

1. Go to [app.supabase.com](https://app.supabase.com)
2. Open project `sgdmiwfvqwgxzhnwekul` (EHR) → click **Restore project**
3. Open project `doteitlmckzcqcijtvdv` (Identity) → click **Restore project**
4. Wait ~2 minutes for both to fully restore

### 2. Push Database Schema (first time only)

```bash
# EHR Backend
cd Awibi-EHR-Backend
npx prisma db push

# Identity Backend
cd Awibi-Identity-Backend
npx prisma db push
```

### 3. Seed Demo Data

```bash
cd Awibi-EHR-Backend
npm run seed
# Credentials are printed to terminal ONLY — never shown in UI
```

### 4. Google OAuth — Add Callback URL in Google Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials → your OAuth 2.0 Client
3. Under **Authorized Redirect URIs**, add:
   - `http://localhost:8000/v1/auth/google/callback` ← local dev
   - `https://ehr.awibi.com/v1/auth/google/callback` ← production
4. **Important:** The trigger URL (`/v1/auth/google`) is NOT the redirect URI — only the `/callback` URL goes here.

### 5. Gmail App Password

1. Sign into `awibihealth@gmail.com`
2. myaccount.google.com → Security → 2-Step Verification → App Passwords
3. Generate for "Mail" → paste (no spaces) into both `.env` files as `MAIL_PASSWORD`

### 6. Change Production Secrets

```bash
# Generate strong random secrets:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Replace all `*-change-in-production*` values in `.env` before going live. The server **exits on startup** if default secrets are detected in production.

---

## First Run

```bash
# Terminal 1 — EHR Backend
cd Awibi-EHR-Backend && npm install && npm run dev

# Terminal 2 — Identity Backend
cd Awibi-Identity-Backend && npm install && npm run dev

# Terminal 3 — EHR Frontend
cd Awibi-EHR-Frontend && npm install && npm run dev

# Terminal 4 (optional) — Identity Frontend
cd Awibi-Identity-Frontend && npm install && npm run dev

# Terminal 5 (optional) — Landing Page
cd Awibi-EHR-Landing-main && npm install && npm run dev
```

Or use `start-all.ps1` which opens all 5 in separate PowerShell windows.

---

## Demo Credentials

> **Security policy:** Credentials are printed to the backend terminal after `npm run seed`. They are NEVER shown in the login UI. Only the administrator should know them.

| Role | Email | Password |
|------|-------|----------|
Demo account emails and passwords are supplied through private local environment variables. They are intentionally absent from source control, documentation, seed output, and the login UI.

Use `Awibi-EHR-Backend/.env.local` for local credentials. Never commit or share that file.

Facility: **UCH Ibadan Demo** · Plan: **SMALL** · 10 patients seeded

---

## Auth Flows

### Standard Email / Password

1. `POST /v1/auth/register` — creates facility + subscription + ADMIN user in one transaction
   - **Dev**: `emailVerified: true`, no OTP sent, immediate access
   - **Prod**: `requiresOtp: true`, 6-digit OTP sent to email
2. `POST /v1/auth/verify-otp` — validates OTP, marks `emailVerified: true`, issues tokens
3. `POST /v1/auth/login` — bcrypt compare, issues access token + sets httpOnly refresh cookie
   - **Prod only**: blocks login if `emailVerified: false`
4. `POST /v1/auth/refresh` — validates refresh cookie, rotates token (old token invalidated in DB)
5. `POST /v1/auth/logout` — clears refresh token from DB and cookie

### Forgot Password

1. `POST /v1/auth/forgot-password` — anti-enumeration: always returns same success message
2. `POST /v1/auth/reset-password` — validates UUID token + email pair, hashes new password
3. `POST /v1/auth/resend-otp` — generates fresh 6-digit OTP (10 min expiry), sends via email

### Token Reference

| Token | Expiry | Storage | Notes |
|-------|--------|---------|-------|
| Access JWT | 15 min | `localStorage` | Contains userId, role, subRole, facilityId |
| Refresh JWT | 7 days | httpOnly cookie | Rotated on every refresh; invalidated in DB. `secure: true` in production. |
| OTP | 10 min | DB only | 6-digit numeric; cleared after successful verification |
| Reset token | 1 hour | DB only | UUID v4; cleared after use |

---

## Google OAuth

1. User clicks "Continue with Google" → browser redirects to `GET /v1/auth/google`
2. Passport redirects to Google consent screen
3. Google calls back `GET /v1/auth/google/callback`
4. Passport strategy finds or creates user, sets `emailVerified: true`
5. Backend issues tokens, sets refresh cookie, redirects to `${FRONTEND_URL}/auth/google?token=...`
6. `GoogleCallback.jsx` reads the token, calls `/auth/me`, syncs BOTH Redux and Zustand, navigates to dashboard

> **Required in Google Console:** The Authorized Redirect URI must be `http://localhost:8000/v1/auth/google/callback` — NOT `/v1/auth/google`. The trigger URL is not the callback.

---

## RBAC Roles & Permissions

| Role | subRole | Module Access |
|------|---------|---------------|
| `SUPER_ADMIN` | — | All modules across all facilities |
| `ADMIN` | — | All modules except clinical cases (by design) |
| `RECORDS` | — | Patients, appointments, admissions, billing |
| `CLINICIAN` | `DOCTOR` | Patients, cases, appointments, lab results |
| `CLINICIAN` | `NURSE` | Patients, cases (read), appointments, admissions |
| `CLINICIAN` | `LAB` | Lab module only |
| `CLINICIAN` | `PHARMACIST` | Prescriptions (read), billing |

Every clinical route: `[authenticate, tenant, requirePermission(module)]`. The frontend mirrors permissions — unauthorized modules show a lock icon and cannot be accessed via URL.

---

## Environment Variables

### EHR Backend (`Awibi-EHR-Backend/.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Required | Supabase transaction pooler (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Required | Supabase session pooler (port 5432) — for `prisma db push` |
| `JWT_SECRET` | Required | Strong random string. Server exits if default used in production. |
| `JWT_REFRESH_SECRET` | Required | Different value from JWT_SECRET |
| `GOOGLE_CLIENT_ID` | Optional | Google Cloud Console. OAuth disabled if missing. |
| `GOOGLE_CLIENT_SECRET` | Optional | |
| `GOOGLE_CALLBACK_URL` | Optional | Must match Authorized Redirect URI in Google Console |
| `MAIL_USERNAME` | Required | Gmail address for OTPs and resets |
| `MAIL_PASSWORD` | Required | Gmail App Password (16 chars, no spaces) |
| `CLOUDINARY_CLOUD_NAME` | Optional | For patient/staff photo uploads |
| `PAYSTACK_SECRET_KEY` | Optional | Use test key in dev. Switch to live only when instructed. |
| `IDENTITY_BACKEND_URL` | Required | `http://localhost:8001` in dev |
| `AWIBI_SHARED_SECRET` | Required | Must match Identity Backend. Change from default in production. |
| `FRONTEND_URL` | Required | `http://localhost:5177` in dev |

### Identity Backend (`Awibi-Identity-Backend/.env`)

Same structure with its own `DATABASE_URL`/`DIRECT_URL` pointing to `doteitlmckzcqcijtvdv`, its own `JWT_SECRET`, and matching `AWIBI_SHARED_SECRET`.

---

## Database Schema

### EHR Backend (project: `sgdmiwfvqwgxzhnwekul`)

| Model | Key Fields |
|-------|-----------|
| `User` | id, email, passwordHash, role, subRole, facilityId, emailVerified, refreshToken, otpCode |
| `Facility` | id, name, type (HOSPITAL/CLINIC/LAB/PROFESSIONAL), plan, logo |
| `Subscription` | facilityId, plan, status, patientLimit, patientsUsed, endDate |
| `Patient` | universalPatientId (`AWB-XXXXXXXX`), firstName, lastName, nin, facilityId |
| `Case` | patientId, facilityId, status (DRAFT/OPEN/CLOSED/REFERRED), captureMethod |
| `Appointment` | patientId, facilityId, doctorId, date, status, charges |
| `Invoice` | facilityId, patientId, invoiceNumber, total, amountPaid, paymentStatus |
| `LabOrder` | patientId, facilityId, testType, status, result |
| `Admission` | patientId, facilityId, ward, bed, admittedAt, dischargedAt |
| `ConsentGrant` | patientId, facilityId, grantedAt, revokedAt (NDPA compliance) |
| `AuditLog` | userId, action, resourceType, resourceId, meta (NDPA audit trail) |

> **CRITICAL:** `CaseStatus` enum only has: `DRAFT`, `OPEN`, `CLOSED`, `REFERRED` — never `IN_PROGRESS`.

### Identity Backend (project: `doteitlmckzcqcijtvdv`)

| Model | Key Fields |
|-------|-----------|
| `PatientIdentity` | universalPatientId (UPID), nin, firstName, lastName, dateOfBirth, phone, passwordHash |
| `IdentityCard` | patientId, cardNumber, qrCodeData |
| `IdentityAccessLog` | patientId, accessedBy (facilityId), accessedAt — NDPA transparency |
| `PatientInboxMessage` | patientId, type, title, body, isRead — lab results delivered here |

---

## API Reference

Full interactive docs: `http://localhost:8000/api-docs` (Swagger UI, dev only)

### Auth (`/v1/auth`)

| Method | Route | Auth | Rate Limit |
|--------|-------|------|------------|
| POST | `/register` | Public | 5/hr |
| POST | `/login` | Public | 10/15min |
| POST | `/staff-login` | Public | Global |
| POST | `/verify-otp` | Public | Global |
| POST | `/resend-otp` | Public | Global |
| POST | `/forgot-password` | Public | 5/15min |
| POST | `/reset-password` | Public | Global |
| POST | `/refresh` | Cookie | Global |
| POST | `/logout` | JWT | Global |
| GET | `/me` | JWT | Global |
| GET | `/google` | Public | Global |
| GET | `/google/callback` | Google | — |
| POST | `/change-password` | JWT | Global |

### Identity Backend (`/v1/identity`)

| Method | Route | Auth |
|--------|-------|------|
| POST | `/verify-nin` | Public (20/15min) |
| POST | `/register` | Public |
| GET | `/lookup/:query` | Public |
| POST | `/login` | Public |
| GET | `/me` | Patient JWT |
| GET | `/me/access-log` | Patient JWT |
| GET | `/me/inbox` | Patient JWT |
| PUT | `/me/inbox/:id/read` | Patient JWT |
| PUT | `/me/password` | Patient JWT |
| POST | `/:id/inbox` | Shared Secret |

---

## NIN Verification

Nigeria's NIMC API is not publicly available. Awibi uses a two-tier fallback:

**Tier 1 — Registry check:** If the NIN exists in the Awibi Identity Database, confirms it and returns the existing UPID.

**Tier 2 — Structural validation:** Validates against NIMC structural rules.

### Validation Rules
- Exactly 11 numeric digits
- Cannot start with `0` (NIMC allocations begin from `10000000000`)
- Not all-same-digit (e.g., `11111111111`)
- Not sequential ascending/descending pattern

```json
POST /v1/identity/verify-nin
{ "nin": "12345678901", "firstName": "Emeka", "lastName": "Obi" }

// Registry hit:
{ "valid": true, "source": "REGISTRY", "nameMatch": true, "partial": { "upid": "AWB-A3K7P2NM" } }

// Format check (demo mode — NIMC API not connected):
{ "valid": true, "source": "FORMAT_CHECK", "message": "NIN passed structural validation (demo mode)" }
```

---

## Security

### Authentication & Tokens
- JWT (15m) + httpOnly refresh cookie (7d, `secure: true` in production)
- Token rotation on every refresh — stolen token invalidated on next use
- bcrypt 12 rounds for password hashing
- OTPs and reset tokens stored in DB only; cleared after use

### Authorization
- Every clinical route: `authenticate → tenant → requirePermission`
- Tenant scoping prevents cross-facility data access
- Frontend mirrors backend permissions — URL and API both enforce

### Rate Limiting
| Route | Limit |
|-------|-------|
| Global | 500/15min |
| Login | 10/15min |
| Register | 5/hr |
| Forgot-password | 5/15min |
| NIN verify | 20/15min |
| Contact form | 10/hr |

### Input Safety
- Prisma ORM — parameterized queries (no SQL injection)
- HTML escaped in email templates and print popups (`escHtml()`)
- Helmet middleware — secure HTTP headers (CSP, HSTS, etc.)
- Paystack webhooks: HMAC-SHA512 signature verified

### NDPA 2023 Compliance
- `AuditLog` records every patient data access
- `ConsentGrant` model tracks patient consent
- Identity Access Log — patients can see who accessed their record

### Anti-Patterns Prevented
- Demo credentials never shown in UI
- Stack traces hidden in production error responses
- Forgot-password is anti-enumeration
- Server exits on startup if JWT secrets are still default values in production

---

## Production Checklist

- [ ] Set `NODE_ENV=production` in both backends
- [ ] Replace all JWT secrets with strong random values (≥48 bytes)
- [ ] Replace `AWIBI_SHARED_SECRET` in both backends (must match)
- [ ] Set `GOOGLE_CALLBACK_URL` to production URL
- [ ] Add production callback URL in Google Cloud Console
- [ ] Switch Paystack to live keys *(only when explicitly instructed)*
- [ ] Set `FRONTEND_URL` to production domain in EHR Backend
- [ ] Set `ALLOWED_ORIGINS` to production domain(s)
- [ ] Upgrade Supabase to Pro plan (prevents auto-pause)
- [ ] Enable HTTPS — refresh cookies require `secure: true` (auto-set in production)
- [ ] Run `npx prisma migrate deploy` instead of `db push` in production
- [ ] Set up PM2 or Docker for zero-downtime restarts

---

## Hosting Options

> No always-on hosting is bundled — all services are stateless and deploy to any Node.js host.

| Service | Recommended | Notes |
|---------|-------------|-------|
| EHR Backend + Identity Backend | Railway, Render, Fly.io | Standard Node.js. Free tiers available. |
| EHR Frontend | Vercel or Netlify | Static build. Set `VITE_API_URL` to prod backend. |
| Identity Frontend + Landing | Vercel or Netlify | Same as above. |
| Database | Supabase Pro ($25/mo) | Prevents auto-pause. |

---

## Awibi Scout

A search box in the dashboard holding 158 clinical references and 14 working
calculators. Open to every signed-in member of staff — it is published reference
material, not patient data, and a nurse checking a drip rate needs it as much as
a consultant checking a score.

**It is a search box, not a menu.** With a thousand entries, choosing from a list
is slower than remembering where the paper copy is. Categories exist for
browsing when nothing is typed; typing is the way in.

### The search ladder

One algorithm cannot answer every kind of question, so six layers each answer a
different kind of failure. A query stops at the first layer confident enough:

| You type | Layer | You get |
|---|---|---|
| `how many drops` | concept bridge | IV Fluid Drip Rate |
| `curb-65` | exact, BM25F over weighted fields | CURB-65 |
| `tetan…` | prefix, while still typing | Tetanus |
| `ketoacid` | character trigram | DKA — Diagnosis |
| `diabetis` | edit distance | still finds it |
| `shock` | facet | the category, never empty |

British and American spellings are folded together, so `anaemia` and `anemia`
reach the same entry. Queries average **0.15 ms** against an in-memory index —
which is what allows results on every keystroke with no request, and what lets
the whole thing keep working with no connection at all.

The interface says *how* an answer was found. A partial or fuzzy match is
labelled as one, because somebody is about to dose against it and a guess
presented as a fact is worse than no answer.

### Calculators

Formulas are stored as expression trees and walked — never passed to `eval`.
Content is data, and data that can execute is a way to run arbitrary code in a
clinician's browser.

Nothing is displayed unless every input is present and inside its allowed range.
A missing height, a 900 kg weight, a zero denominator: each is refused with a
plain reason. **A number on screen is taken as correct, so being absent beats
being wrong.**

Six entries whose formulas branch on sex or step through weight bands are shown
as written formulas rather than as a Calculate button that could never produce
an answer.

### Built for a poor connection

| | |
|---|---|
| Search index | **33 KB** on the wire, gzipped |
| Entry body | ~5 KB, only when opened |
| Second visit | **0 bytes** — HTTP 304 |
| Offline | one tap saves all 158 entries (~1.7 MB) |

Response compression is enabled service-wide, which is a four-fold saving on
this payload and a large one on every list endpoint.

Content updates without a code change: `scripts/build-scout-data.js` regenerates
the served data from the source corpus.

---

## Clinical modules

The layer below turns the record from a filing system into something a ward runs on.
All of it is tenant-scoped and permission-gated; none of it changes authentication.

### Monitoring engine

One configurable engine drives every observation chart, rather than a screen per chart type.
A sheet declares what it monitors and what "normal" means for each item; entries are graded
against that on the server.

| Sheet type | Watches |
|---|---|
| `VITALS` | BP, pulse, respiratory rate, temperature, **SpO2**, oxygen support, pain |
| `BGL_INSULIN` | Blood glucose, insulin given, hypoglycaemia treatment, ketones |
| `IV_FLUID` | Fluid, rate ordered vs actual, volume infused, derived volume remaining |
| `INTAKE_OUTPUT` | Oral and IV intake against urine and other output |
| `URINARY_CATHETER`, `NGT_FEEDING`, `SURGICAL_DRAIN`, `BLOOD_TRANSFUSION`, `WOUND_CARE`, `NEURO_OBSERVATION`, `SEIZURE_WATCH`, `CUSTOM` | As named |

**Severity is decided on the server**, from the sheet's own bands, and a client cannot
downgrade it. There are two levels of abnormal on purpose — `HIGH`/`LOW` means note it,
`CRITICAL_*` means act now. Collapsing them gives you either constant alarms nobody reads,
or an emergency styled like a mildly raised value.

Derived helpers: sliding-scale insulin **suggestion** (explicitly `isSuggestionOnly`), IV bag
remaining volume, bag-change warning under 50 ml, pump drift warning above 10% and critical
above 25%.

**Doctors do not author observations.** An observation states that a named person was at the
bedside and saw something, and blurring that helps nobody in an incident review. Doctors hold
`monitoring_review` instead: acknowledge, request a recheck, or request a change to the plan.
The nurse sees it on their worklist and closes it with what was done.

### Standing orders

`Order` + `OrderExecution`, covering `MEDICATION`, `NURSING`, `DIET`, `ACTIVITY`, `TREATMENT`,
`LAB`, `IMAGING`. Separate from the task worklist because they answer different questions —
the worklist asks *what is due now*, an order asks *what was instructed, by whom, toward what
goal, and is it happening.* A recurring order carries **many** executions, so a Q2H turn order
over three days can be told apart from one carried out twice.

Skipping requires a reason. A recorded skip is a clinical fact; one that simply never appears
is a hole nobody can explain later. Overdue is judged from the last execution with 25% grace,
so one late round does not mark every later one overdue forever.

### Resuscitation

`ResuscitationEvent` + `ResuscitationTimelineEntry`, with ACLS, Sepsis Six and a deteriorating-
patient checklist seeded as JSON. The board is built for someone with one free hand: ≥60px
targets, one tap per action, offsets derived from the clock rather than typed. Repeat intervals
that have fallen due are surfaced automatically — the thing a team cannot track reliably while
compressing. The only confirmation on the board is defibrillation, because that is the one
action that can injure the person delivering it.

A second responder opening the board **joins** the running record rather than creating a second
half-complete account. Resuscitation records follow the patient through the emergency
temporary-to-permanent merge.

### Alerts

`GET /alerts` derives the facility's outstanding work from current state rather than storing
notification rows. A stored alert has to be created, delivered, de-duplicated and expired, and
goes stale the moment the underlying fact changes. Deriving means an alert disappears exactly
when the thing it describes is dealt with. Repeated critical readings collapse to one entry per
patient per measurement, and each role is shown only what it can act on.

### Enquiries and the public page

Every facility has a **stored** `slug` (`/clinic/uch-ibadan-demo`). It used to be derived from
the facility name, which meant two facilities sharing a name collided and a rename silently
broke every published link.

Public enquiries are **written to the database before any email is attempted**. The previous
contact form only sent mail, so a bad SMTP password meant an enquiry describing chest pain
vanished with nothing to show it had arrived. Keyword routing suggests a department and flags
anything that could be an emergency — routing only, never a diagnosis, and the urgent reply
tells the person to go rather than wait.

### Internal messaging

Plain staff-to-staff messaging scoped to one facility, able to reference a patient. It exists
because ward conversations that matter currently happen on personal WhatsApp, which puts
patient details on personal phones outside the record. Not a clinical order — anything that
must be acted on is an Order.

---

## What Is NOT Built

See **[NOT_BUILT.md](NOT_BUILT.md)** for the full checkable list. Summary:

- Pharmacy module (no model, routes, or page)
- Patient self-booking from Identity Portal
- Playwright / Cypress end-to-end tests — the browser layer is the one substantial untested surface
- WHO growth reference tables — Z-scores return `null` rather than a wrong number
- Per-facility timezone (process is pinned to `Africa/Lagos`; correct for Nigeria only)
- Voice capture (placeholder only), AI triage beyond keyword mapping
- Multilingual / i18n support (deliberate skip — no business requirement)
- Mobile app (download page is a placeholder)

---

## Testing

```bash
npm run test:unit    # 32 checks — pure logic, no server needed
npm run test:smoke   # 363 checks — every endpoint, every role, against a live API
npm run test:loops   # 47 checks — each workflow from initiation to completion
npm run test:all     # all three
```

The loop audit is the one worth explaining. It does not test endpoints in
isolation; it walks each feature the way a person would — register a patient,
open an encounter, sign it, order something, watch it reach the nurse's
worklist, complete it, watch the count rise. A feature that can be started but
not finished is a dead end, and one that finishes without notifying anyone
downstream is a silent loss. Neither shows up in an endpoint test.

Two tests exist purely to catch drift rather than defects: the frontend keeps
its own copy of the permission map to render the sidebar, and when the two
disagree the UI either hides a screen the user may open or offers a button the
API refuses. Both look like bugs and neither appears anywhere else.

---

*Awibi EHR · Built July–August 2026 · NDPA 2023 compliant*
