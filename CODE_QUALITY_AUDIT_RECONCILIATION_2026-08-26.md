# Code-quality audit reconciliation — 26 August 2026

This document reconciles the supplied requirements, design, code-quality and QA notes against the repository. The supplied documents were treated as review evidence, not as proof that every statement was current. No item below changes the clinical product boundary.

## Corrected safely in this release

- Centralised JWT configuration and removed predictable secret fallbacks in production.
- Replaced `Math.random()` OTP generation with cryptographic generation; OTPs and newly issued refresh tokens are stored as hashes. Existing local beta refresh tokens remain temporarily compatible so demo sessions are not forcibly broken.
- Added refresh-token rotation identifiers and matching cookie clear/set options. Production cross-site cookies remain `SameSite=None; Secure`; using `Strict` would break the current Vercel-to-Render topology.
- Hardened Paystack webhook verification to fail closed and use constant-time HMAC comparison.
- Added request correlation IDs, privacy-safe structured request/error context and a database-aware health check.
- Raised new-registration password requirements while preserving login compatibility for existing demo accounts.
- Removed the duplicate Zustand authentication store; Redux is now the single client authentication state.
- Removed the hard-coded local Google OAuth URL and use the configured API base URL.
- Added route-level error containment, lazy-loaded dashboard routes, a keyboard skip link, visible focus treatment and a two-minute idle-session warning.
- Added deployment CSP/HSTS headers, externalised the startup diagnostic script, and added a non-indexing `robots.txt` plus a web manifest.
- Added automated security/configuration regression checks and GitHub quality gates.

## Findings that were already implemented or stale

- Frontend and backend automated tests already existed.
- Paystack already used a signature; this release tightened its failure behaviour and comparison.
- Offline queue/service-worker support, consent records, tenant filters, clinical audit events, navigation role checks and production Cloudinary/Nodemailer packages were already present.
- The project already uses Prisma with PostgreSQL. Prisma is the ORM, not a competing database service.

## Deliberately deferred: approval or architecture work required

- Moving the **access token** from browser storage into an HttpOnly cookie is a valuable security migration, but it affects every API call, CORS/CSRF controls, Google login, offline behaviour and demo access. It must be designed and tested as one session-architecture change; it was not mixed into this safe correction release.
- Persistent login-attempt lockout, device/session management, MFA and refresh-token reuse-family detection require database and operational changes.
- PostgreSQL RLS and a versioned migration baseline require a table-by-table rollout and production-data rehearsal. Current tenant isolation remains application-enforced and regression-tested.
- A complete immutable audit viewer/retention programme, FHIR/openEHR conformance, production MPI, PACS/DICOM, medication knowledge and true offline deployment remain separate governed programmes.
- Privacy notices, DPIA, consent wording, data residency and retention rules need accountable legal/clinical approval; placeholder legal text was not invented.

## External release gates

See `MANUAL_SETUP_REQUIRED.txt` for the concise priority list. In particular: production same-site domain/cookie validation, exact CORS/CSP origins, TLS and secrets; persistent hosting and monitoring; square installable-app icons; independent penetration, accessibility, physical-device and load tests; and clinical/legal sign-off.

## Release interpretation

Passing local automation supports a **controlled synthetic-data beta**. It does not certify the system for real patient data, national deployment, regulatory compliance, complete interoperability or full offline clinical operation.
