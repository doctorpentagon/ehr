# Awibi EHR authentication, authorization, RBAC, tenancy, and RLS guide

Status: implementation guide, not a compliance certificate. Last verified against the local test suite on 11 August 2026.

## What the system uses today

Prisma and Supabase are not competing choices. Prisma is the Node.js data-access layer. PostgreSQL is the database. Supabase can host PostgreSQL, but the current local system uses PostgreSQL on the workstation and the documented evaluation deployment uses Render PostgreSQL. Moving PostgreSQL between hosts does not require replacing Prisma.

The current request path is:

1. `authenticate` validates the access JWT and reloads the active user from PostgreSQL.
2. It builds `req.ctx` from the database user: `userId`, `role`, `subRole`, and `facilityId`.
3. `tenant` rejects users without a facility context, except the platform Super Admin.
4. `requirePermission(name)` enforces the server permission map.
5. Each clinical query must include `facilityId: req.ctx.facilityId` or an equivalent relation filter.

The frontend permission map is usability only. The backend remains the authority.

## Current sign-in modes

- Email/password: bcrypt password verification, 15-minute access JWT, rotating seven-day refresh cookie.
- Staff login: same token/session path, using the staff credential flow.
- Google OAuth: optional external setup; not required for local development.
- Local demo: passwordless account selection enabled only by the local launcher. It issues a real token and keeps RBAC and tenant scoping active.
- Hosted demo: disabled unless both the explicit demo flag and acknowledgement sentence are configured. It must contain synthetic data only.

Never implement a global middleware bypass that injects a Super Admin. That would prevent meaningful role and tenant testing.

## Role model

| Role | Intended authority |
|---|---|
| `SUPER_ADMIN` | Awibi platform operations. Cross-facility platform functions only where the route explicitly supports them. |
| `ADMIN` | Facility administration and oversight; not licensed clinical authorship. |
| `RECORDS` | Demographics, appointments, booking intake, household records, and emergency intake. |
| `CLINICIAN/DOCTOR` | Clinical notes, diagnoses, prescriptions, orders, review, admission decisions, and clinical acknowledgement. |
| `CLINICIAN/NURSE` | Bedside observations, medication administration, monitoring, handover, and nursing-task execution. |
| `CLINICIAN/LAB` | Diagnostic work queue and results, without general patient-record access. |
| `CLINICIAN/PHARMACIST` | Prescription reading and the allowed pharmacy/billing functions. |

Write permissions are intentionally narrower than read permissions. For example, an administrator can oversee a clinical record but cannot sign it; a doctor can review nursing monitoring but cannot author a bedside observation.

## Tenant isolation today

Tenancy is enforced in the application layer. Facility-owned tables carry `facilityId`, and API queries filter using the authenticated context. Cross-facility reads return `404` so they do not reveal that a record exists.

The test suite verifies both list isolation and direct-ID attacks. The 11 August 2026 run refused all six direct cross-facility probes and verified role access across 54 allowed and 37 refused screens.

## Important correction: PostgreSQL RLS is not enabled yet

The codebase does not currently define PostgreSQL `ENABLE ROW LEVEL SECURITY` statements or `CREATE POLICY` rules. Calling the current design “RLS” would be inaccurate. It is tested application-layer tenant scoping.

Before enabling database RLS:

1. Inventory every facility-owned table and every legitimate cross-facility platform query.
2. Add a transaction-scoped database context such as `SET LOCAL app.facility_id` and `SET LOCAL app.user_id`.
3. Create deny-by-default policies for select, insert, update, and delete.
4. Give background jobs an explicit, audited service role rather than bypassing all policies.
5. Define the Super Admin policy per operation; never give an unconditional global database bypass to the web role.
6. Keep application-layer filters as defence in depth.
7. Add migration tests using separate database roles, not only mocked Prisma calls.
8. Re-run the direct-ID tenancy suite against the RLS-enabled database.

## Session and cookie hardening backlog

- Move the access token from `localStorage` to a memory-first or backend-for-frontend design before production health-data use.
- Keep refresh tokens httpOnly, `Secure`, and narrowly scoped; add an explicit cookie path and production domain policy.
- Add refresh-token family/reuse detection and device-session revocation.
- Add CSRF protection before relying on cookies for authenticated mutations.
- Pin allowed origins; never use wildcard CORS with credentials.
- Add account lockout/risk controls without creating a user-enumeration signal.
- Require MFA for Super Admin and facility administrators.
- Record successful and failed sign-in events without logging passwords, tokens, or clinical data.
- Define emergency “break glass” access with reason, time limit, notification, and audit review.
- Test clock skew, token expiry during offline work, password reset, deactivation, and staff transfer between facilities.

## EHR and Awibi Identity separation

Awibi EHR is institution-operated infrastructure for hospital, clinic, and laboratory staff. Awibi Identity is the mass-user product through which a person receives and manages identity-linked health information. They should be separate deployable products with separate databases, secrets, sessions, and threat boundaries.

Link them through versioned APIs and events:

- The EHR stores its local patient record plus the minimum external identity reference needed for matching.
- Awibi Identity owns the consumer account, verification factors, consent preferences, and health-information inbox.
- A facility publishes a signed clinical-document event; Identity records delivery for the verified person.
- Consent, revocation, correction, merge, and access events are append-only and auditable.
- Neither product reads the other product's database directly.
- Shared secrets are a temporary internal mechanism; production integration should use asymmetric service identity, key rotation, replay protection, and scoped service permissions.

## Release gate

Authentication is not production-ready merely because local login works. Production enablement requires threat modelling, data-flow mapping, an NDPA-aligned privacy assessment, retention/deletion rules, incident response, backups/restore evidence, key management, dependency/secret scans, penetration testing, and documented operational ownership.
