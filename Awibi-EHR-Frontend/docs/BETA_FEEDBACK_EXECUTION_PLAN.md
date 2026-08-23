# Beta feedback execution plan

This plan converts the two beta-feedback files into testable work. A checked item means evidence exists in code or a completed test; it does not mean the whole product is production-ready.

## A. Startup and local access

- [x] Keep real RBAC and facility tenancy active in local demo entry.
- [x] Make local demo accounts selectable without sharing fixture passwords.
- [x] Explain the Vite proxy 500 as an API-startup failure rather than invalid credentials.
- [x] Add unit coverage for connection failure, real server 500, structured OTP/demo errors, and 401 messages.
- [x] Make the workstation launcher wait for API health before opening the frontend.
- [x] Verify Super Admin demo entry in the browser.
- [x] Verify Doctor demo entry and blocked admin/platform navigation.
- [x] Verify `/auth/me` and all role sessions in the API smoke suite.
- [ ] Add a tracked, cross-platform one-command EHR launcher; the current all-products PowerShell launcher is workstation-local.
- [ ] Add startup diagnostics for database unavailable, wrong port, and stale Prisma client in one user-facing screen.

## B. Low bandwidth and offline correctness

- [x] Split production bundles into stable vendor, state, icon, chart, and application chunks.
- [x] Cache hashed static assets and use network-first HTML to avoid a permanently stale application shell.
- [x] Delete older application caches when the service-worker version changes.
- [x] Queue authenticated JSON mutations in IndexedDB when the browser is truly offline.
- [x] Replay queued calls through the configured `/v1` API client instead of the frontend route.
- [x] Never store Authorization tokens inside queued records.
- [x] Scope every queued record to the originating facility and user.
- [x] Refuse to replay one user's or tenant's work in another session.
- [x] Discard permanent 4xx conflicts but retain network and 5xx failures for retry.
- [x] Align the service-worker and page background-sync message names.
- [x] Register a background-sync opportunity on supporting Android browsers.
- [x] Show only the current user's pending queue count.
- [ ] Add idempotency keys to every offline-capable mutation before claiming exactly-once sync.
- [ ] Cache an explicitly approved, encrypted subset of previously accessed clinical reads; API GET responses are deliberately not cached today.
- [ ] Add an offline draft store for consultation notes before submission.
- [ ] Add a conflict-resolution screen for optimistic-lock and validation failures.
- [ ] Add a queue inspector that names the action without exposing clinical text on a shared screen.
- [ ] Define maximum offline retention and automatic secure deletion.
- [ ] Encrypt sensitive offline payloads with a device/session key and document the lost-device model.
- [ ] Test airplane-mode create, browser restart, token refresh, reconnect, duplicate response, 409 conflict, 500 retry, logout, and account switch in a real Android browser.
- [ ] Replace the support-page claim that broad clinical reads work offline; today only the application shell, Scout content, and queued JSON writes have evidence.

## C. Android and mobile use

- [x] Add `npm run dev:lan` as an explicit same-Wi-Fi Android test mode.
- [x] Verify the Doctor dashboard at 360 x 800 with mobile navigation.
- [x] Verify the New Encounter chooser at 360px with no horizontal overflow.
- [x] Verify the SOAP form at 360px with no horizontal overflow.
- [ ] Add a web-app manifest, 192px/512px maskable icons, theme colour, and install metadata.
- [ ] Test installation and relaunch on a low-cost physical Android phone.
- [ ] Test camera and microphone permissions on HTTPS or an approved secure local test origin.
- [ ] Test the on-screen keyboard against patient search, SOAP fields, modals, and date/time controls.
- [ ] Measure first load and repeat load on throttled 3G and a low-end CPU profile.
- [ ] Remove or self-host the Google Font dependency so first paint does not depend on an external font host.
- [ ] Audit the 995 KB nurse illustration and all non-critical imagery for responsive delivery/lazy loading.
- [ ] Document that `localhost` on a phone means the phone itself; LAN testing uses the workstation IP and `dev:lan` only with synthetic data.

## D. One smart consultation input

- [x] Keep bold clinical section headings as presentation, independent of note content.
- [x] Confirm the current database stores SOAP fields as plain strings.
- [x] Confirm signed notes are immutable and concurrent stale edits are rejected.
- [x] Confirm the current UI has four separate capture modes, not the requested one-box/three-door workflow.
- [ ] Define a versioned editor JSON schema plus a separately derived plain-text value for search, decision support, exports, and interoperability.
- [ ] Add database fields and a backwards-compatible migration without changing existing signed notes.
- [ ] Add a light toolbar only: Bold, Italic, Bullet List, and Numbered List.
- [ ] Sanitize editor JSON/HTML on both write and render; never trust client formatting.
- [ ] Insert typing, voice transcription, OCR text, and questionnaire answers into the same editor transaction.
- [ ] Preserve plain-text insertion for voice/OCR so formatting marks cannot corrupt the transcription.
- [ ] Define deterministic plain-text extraction and test nested lists, marks, blank paragraphs, and pasted content.
- [ ] Add autosave with optimistic versioning and a visible “saved/offline/conflict” state.
- [ ] Make microphone and camera buttons keyboard accessible and give them explicit permission/error states.
- [ ] Implement actual speech-to-text; the current Voice mode records audio but does not transcribe it.
- [ ] Implement actual OCR; the current Scan/OCR mode uploads a file but does not prove handwriting extraction.
- [ ] Make questionnaire answers insert into the same structured note rather than a separate mode.
- [ ] Test create, edit, sign, print, export, search, offline draft, sync, and amendment flows before replacing the existing editor.
- [ ] Do not integrate Microsoft Word; no requirement needs a Word file or Microsoft dependency.

## E. Privacy, clinical safety, and identity integration

- [x] Keep Prisma as the ORM and PostgreSQL as the database; a hosted Supabase PostgreSQL instance is optional infrastructure, not a replacement for Prisma.
- [x] Keep EHR and Awibi Identity as separate products, deployments, secrets, databases, and user experiences.
- [x] Verify application-layer facility isolation with direct-ID cross-tenant tests.
- [x] Verify clinical authoring boundaries for Admin, Doctor, Nurse, Records, and Lab roles.
- [x] Keep clinical decision support auditable and deterministic where calculators/ranges are implemented.
- [x] Replace public Identity PII lookup with a non-disclosing continuity-code check.
- [x] Add consented facility-to-Identity pairwise linkage, explicit revocation, and private facility resolution.
- [x] Add consent-scoped final diagnostic delivery with source/version provenance, content hashing, and idempotent replay.
- [x] Preserve local patient registration when the Identity service is unavailable.
- [x] Ensure Identity revocation touches only the Identity consent grant.
- [ ] Stop describing the current tenant filters as PostgreSQL RLS; database policies are not implemented yet.
- [ ] Complete a table-by-table RLS design and migration with separate database roles.
- [ ] Complete the health-data inventory, purpose map, retention schedule, and deletion/legal-hold rules.
- [ ] Complete an NDPA-aligned DPIA and obtain legal/compliance review; code alone is not certification.
- [ ] Define encryption-at-rest ownership, KMS/HSM choice, rotation, backups, and restore procedures.
- [ ] Add field-level protection for the highest-risk identifiers only after search/index requirements are designed.
- [ ] Define operator/support access, approval, time limits, audit review, and break-glass procedure.
- [ ] Cryptographically sign EHR-to-Identity envelopes and implement production key rotation; versioning, hashing, replay protection, and idempotency are implemented for local beta.
- [ ] Complete Identity correction, patient merge, guardian/dependant, disputed-link, and durable delivery-failure/dead-letter workflows; grant/link/revoke/delivery are implemented.
- [ ] Validate every clinical decision-support rule with a named guideline version, clinical owner, review date, contraindication boundaries, and test cases.
- [ ] Run clinical safety review, penetration test, backup restore exercise, and incident-response tabletop before real patient use.

## F. Diagnostics and closed-loop clinical workflow

- [x] Separate clinician ordering from diagnostics processing permissions.
- [x] Remove “New Request” from diagnostic staff while retaining a clinician order action.
- [x] Add laboratory collection/receipt, processing, preliminary, final, correction, and cancellation transitions.
- [x] Add specialist roles and discipline-scoped queues for radiology/radiography, haematology, chemical pathology, histopathology/morbid anatomy, and microbiology.
- [x] Snapshot age/DOB, gender, discipline, units, and approved ranges at order time.
- [x] Prevent result-entry staff from overriding catalogue ranges.
- [x] Add complete report viewing with structured values, narrative, findings, impression, files, and result versions.
- [x] Add affiliate diagnostic referral and audited transfer state.
- [x] Add explicit clinician review for routine reports.
- [x] Require critical results to use the durable acknowledge/action/resolve lifecycle.
- [x] Add explicit, consent-gated release of final reports to Awibi Identity.
- [x] Expand and seed the local catalogue across major laboratory and imaging disciplines.
- [ ] Complete PACS/DICOM, analyser/barcode, laboratory QC, device, and facility-approved method/range integrations.

## Current release decision

The login/startup, navigation, Identity linkage, diagnostic workflow, and offline-queue corrections are suitable for continued synthetic-data local beta testing because their unit, build, API, workflow, RBAC, tenancy, and rendered-browser gates pass. Full offline clinical use, installable Android PWA status, rich-text consultation, database RLS, production authentication, PACS/analyser integration, independent safety/security review, and compliance remain explicitly pending and must not be represented as complete.
