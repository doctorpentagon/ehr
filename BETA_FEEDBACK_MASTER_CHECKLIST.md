# Awibi EHR beta-feedback master checklist

Last audit update: 23 August 2026 (Africa/Lagos). Automated evidence must be rerun after the current schema/security changes before the historical pass counts below are treated as current.

This is the traceable disposition of the two beta Word documents, the two supplied analyses, and the existing research/audit material. A checked box means the item is implemented and has objective local evidence. An unchecked box is intentionally visible work or an external dependency; it must not be presented as complete.

## Release gate A — local access, startup, and navigation

- [x] A1. Local demo access does not require testers to copy rotating fixture passwords.
- [x] A2. The login screen clearly separates local demo access from production account login.
- [x] A3. Local role selection retains the real RBAC and facility tenant context.
- [x] A4. Backend health is available at `/v1/health`; Identity health is available at `/healthz`.
- [x] A5. API 500/startup failures are distinguished from invalid credentials in the frontend error policy.
- [x] A6. Desktop sidebar can collapse and expand.
- [x] A7. Desktop sidebar state persists on the workstation.
- [x] A8. Mobile navigation and 44px primary touch targets remain available.
- [x] A9. Every visible navigation destination resolves to a real route (49 routes checked at build time).
- [x] A10. Every role-visible API screen opens and every unavailable screen is refused (54 allowed, 37 refused).
- [ ] A11. Add a cross-platform one-command launcher; the current complete launcher is PowerShell/Windows.
- [ ] A12. Add a single startup-diagnostics screen for database, port, migration, and stale-client failures.

## Release gate B — patient identification and Awibi Identity

- [x] B1. Keep two separate products: provider-owned Awibi EHR and citizen-owned Awibi Identity.
- [x] B2. Keep separate applications, databases, secrets, sessions, and user experiences.
- [x] B3. Retain a facility-local Patient ID and hospital number for downtime and ordinary care.
- [x] B4. Treat the public continuity code as a lookup aid, never as an authorization credential or database foreign key.
- [x] B5. Generate a random pairwise Identity identifier for each facility relationship.
- [x] B6. Prevent one facility from resolving another facility's pairwise identifier.
- [x] B7. Require an explicit consent confirmation before linking an EHR patient to Identity.
- [x] B8. Store the consent reference, scope, linkage time, assurance, and active/revoked state.
- [x] B9. Preserve the local EHR patient record if the external Identity link is temporarily unavailable.
- [x] B10. Deactivate a just-created consent grant when linkage fails.
- [x] B11. Revoke only the Identity-specific consent grant, not unrelated clinical consents.
- [x] B12. Prevent ordinary demographic edits from overwriting protected Identity linkage fields.
- [x] B13. Remove automatic NIN matching from ordinary patient registration.
- [x] B14. Remove public PII/card disclosure from continuity-code lookup.
- [x] B15. Require authenticated facility service access for private Identity-card resolution.
- [x] B16. Deliver only final, consented diagnostic reports to an active pairwise Identity link.
- [x] B17. Attach facility, source record, result version, consent reference, and SHA-256 content hash to inbox delivery.
- [x] B18. Make a replay of the same diagnostic source/version idempotent.
- [x] B19. Give the Identity user an access log and inbox for delivered information.
- [x] B20. Provide explicit link and revoke controls on the EHR patient page.
- [x] B21. Provide an explicit final-result release control in the diagnostics report viewer.
- [ ] B22. Replace raw NIN storage with the approved tokenisation/field-protection design after the NIMC/legal/search design is signed off.
- [ ] B23. Add a database uniqueness/idempotency guarantee that remains safe under two truly concurrent deliveries.
- [ ] B24. Complete patient merge, Identity correction, deceased-person, guardian/dependant, and disputed-link operating procedures.
- [ ] B25. Implement cryptographic envelope signing and key rotation; the current local beta has provenance, versioning, hashing, and shared-service authentication, not digital signatures.
- [ ] B26. Add an organisation/branch network model and policy-enforced cross-branch exchange; a shared UPID does not currently make Branch A's chart available in Branch B.
- [ ] B27. Implement an enterprise MPI with scored matches, duplicate-review queue, survivorship, merge/unmerge, correction propagation, and profiled FHIR `Patient/$match`; current exact lookup and duplicate safeguards are useful but are not a complete MPI.

## Release gate C — consultation to diagnostic order

- [x] C1. Only a clinician with `diagnostic_order` can create an investigation order.
- [x] C2. Diagnostic staff cannot see or call the clinician's “Order investigation” action.
- [x] C3. One structured consultation can atomically create the signed clinical case, medicines, nursing orders, and diagnostics.
- [x] C4. Invalid nested medication data rolls back the entire consultation transaction.
- [x] C5. Encounter types are facility-scoped and built-ins cannot be renamed or deleted.
- [x] C6. A signed note is immutable and stale edits are rejected with optimistic locking.
- [x] C7. Every clinician order path uses the active facility diagnostic catalogue; New Encounter no longer accepts a free-text LAB/IMAGING bypass.
- [x] C8. Every diagnostic order snapshots catalogue range, unit, discipline, specimen, age/DOB, and gender context.
- [x] C9. The order carries the clinical question/notes actually typed in the UI.
- [x] C10. Switching test type clears stale selection and immediately reloads the correct catalogue group.
- [x] C11. Custom/non-catalogue tests remain possible but cannot invent numeric reference ranges at result entry.
- [ ] C12. Replace the four plain SOAP capture modes with one versioned structured editor accepting typed, voice, OCR, and questionnaire input.
- [ ] C13. Add autosaved offline consultation drafts with conflict resolution before replacing the stable plain-text editor.

## Release gate D — diagnostic processing and specialist workspaces

- [x] D1. Model LAB, IMAGING, ECG, and OTHER requests in one coherent workflow.
- [x] D2. Add specialist staff roles for radiology, radiography, haematology, chemical pathology, histopathology/morbid anatomy, and microbiology.
- [x] D3. Scope each specialist queue to its permitted modality or discipline.
- [x] D4. Enforce PENDING → COLLECTED → IN_PROGRESS for laboratory specimens.
- [x] D5. Enforce PENDING → IN_PROGRESS for imaging/non-specimen work.
- [x] D6. Prevent a status-only call from bypassing result verification to mark work complete.
- [x] D7. Allow preliminary reports, final reports, and audited corrected versions.
- [x] D8. Reset clinician-review state whenever a corrected result is issued.
- [x] D9. Prevent result staff from silently overriding facility reference/critical ranges.
- [x] D10. Compute low/high/critical flags on the server from the approved catalogue.
- [x] D11. Show patient age and gender in the queue and full result view.
- [x] D12. Show complete narrative, structured values, ranges, findings, impression, notes, specimen, and files.
- [x] D13. Support referral to a compatible configured affiliate provider with an audit event.
- [x] D14. Search diagnostics by patient name, Patient ID, hospital number, test, or discipline.
- [x] D15. Expand the local beta catalogue across chemistry, haematology, microbiology, parasitology, serology, histopathology/morbid anatomy, X-ray, ultrasound, CT, MRI, mammography, Doppler, fluoroscopy, and cardiology imaging.
- [x] D16. Seed the expanded catalogue idempotently in both local beta facilities (36 created, 50 retained).
- [ ] D17. Obtain named facility clinical approval for method-, analyser-, age-, sex-, pregnancy-, and population-specific ranges before clinical use.
- [ ] D18. Integrate a production PACS/DICOM store, modality worklist, diagnostic viewer, and immutable image retention policy.
- [ ] D19. Implement accession/barcode printing, rejection reasons, chain of custody, analyser interfaces, and laboratory quality-control rules.
- [ ] D20. Implement specialist report co-signing and multidisciplinary review where facility governance requires it.

## Release gate E — results, alerts, nursing, and closed loops

- [x] E1. A routine reported result requires an explicit, attributable clinical-review event.
- [x] E2. A critical result cannot be marked reviewed before its critical alert is acknowledged.
- [x] E3. Critical results create a durable alert assigned to the ordering clinician.
- [x] E4. Each corrected critical version creates a distinct, deduplicated alert episode.
- [x] E5. Critical lifecycle is OPEN → ACKNOWLEDGED → ACTED_ON → RESOLVED.
- [x] E6. Acknowledgement records a named clinician and timestamp.
- [x] E7. Action requires a meaningful action note.
- [x] E8. Resolution requires an outcome and does not occur merely because a repeat value normalises.
- [x] E9. The alert links clinicians back to Diagnostics or the relevant monitoring sheet.
- [x] E10. Monitoring thresholds are defined server-side and cannot be downgraded by the browser.
- [x] E11. Repeated monitoring values deduplicate into one active safety episode.
- [x] E12. Doctors can request correction/recheck; nurses receive and close that loop.
- [x] E13. Doctor orders reach the nursing worklist without re-entry.
- [x] E14. STAT work outranks routine work and recurring work reschedules correctly.
- [x] E15. Skips, holds, stops, unscheduled doses, and corrections require attribution/reasons.
- [x] E16. Emergency intake works before identity is known and safely merges into the permanent record.
- [x] E17. Consultation and monitoring capture the authenticated professional and immutable EHR server time automatically.
- [x] E18. Retrospective consultation/monitoring preserves separate care time and EHR entry time, requires a reason, displays the professional/time controls, and rejects future times; local Prisma migration and live E2E passed on 23 August 2026.
- [ ] E19. License and integrate a production drug-interaction/allergy checking knowledge base; current allergy capture is not a complete interaction engine.
- [ ] E20. Validate WHO paediatric BMI/anthropometry datasets and age/sex z-score presentation under a named paediatric clinical owner.

## Release gate F — privacy, scale, operations, and production

- [x] F1. Application-layer tenant isolation blocks direct-ID reads across facilities.
- [x] F2. Backend and frontend permission maps agree.
- [x] F3. Admin, Records, Doctor, Nurse, Diagnostics, and Super Admin authoring boundaries are tested.
- [x] F4. Document downloads require authorization and metadata does not expose storage paths.
- [x] F5. Local beta services and both production frontend builds pass.
- [x] F6. The external/manual work is separated into `MANUAL_SETUP_REQUIRED.txt`.
- [ ] F7. Implement and test PostgreSQL row-level-security policies; Prisma tenant filters are not database RLS.
- [ ] F8. Complete DPIA, data inventory, purpose/retention map, legal holds, consent notices, and Nigerian legal review.
- [ ] F9. Complete KMS/HSM, secret rotation, TLS, WAF, backup/restore, disaster recovery, monitoring, and incident response.
- [ ] F10. Run independent clinical-safety review, penetration test, accessibility audit, load/soak test, and backup-restore exercise.
- [ ] F11. Validate physical Android/PWA, intermittent-network, low-end device, printer, barcode, scanner, camera, and microphone workflows.
- [ ] F12. Complete pharmacy inventory/procurement/dispensing controls, attendance/HR integrations, and a citizen patient portal beyond the Identity inbox.
- [ ] F13. Complete on-prem/offline deployment packaging and support procedures for facilities with unreliable internet.
- [ ] F14. Establish national/continental governance, terminology service, FHIR conformance, facility onboarding, support SLAs, and regional data-residency strategy.
- [x] F15. Refuse Awibi `SUPER_ADMIN` on every tenant clinical route even when a synthetic demo facility is attached; platform oversight remains on `/v1/platform` only.
- [x] F16. Refuse hosted passwordless demo startup unless a 16+ character access code is configured, in addition to the explicit danger acknowledgement.
- [ ] F17. Replace browser `localStorage` access tokens with a reviewed session design and complete CSRF/XSS, revocation, rotation, and privileged MFA controls.
- [ ] F18. Implement complete PHI read/query/download audit coverage and tamper-evident central retention; selected write/platform events are not equivalent to complete access auditing.

## Automated evidence rerun on 23 August 2026

- EHR backend unit: 38/38 passed, including platform-operator tenant refusal.
- EHR API contract: 175 distinct frontend calls resolved across 248 served routes.
- EHR API smoke: 364/364 passed.
- Consultation/monitoring clinical closure: 38/38 passed, including retrospective care time/reason and future-time rejection.
- Full workflow loops: 52/52 passed.
- Role dashboards: 42 allowed screens opened; 49 unavailable screens refused after narrowing Super Admin to one platform API surface.
- Tenant isolation: 6/6 exact cross-facility record fetches refused.
- Identity backend unit: 6/6 passed.
- Identity API smoke: 27/27 passed.
- EHR frontend production build: 9,146 modules transformed successfully.
- Identity frontend production build: 1,640 modules transformed successfully.
- Rendered browser: `http://localhost:5177` launches; Super Admin lands on Platform, has a platform/settings/support-only navigation, and direct patient-record navigation is refused; doctor dashboard, patient chart, all four consultation capture choices, named/server-time attribution, structured non-checkbox-only questionnaire, and retrospective date/time plus reason controls rendered successfully.

## Current release decision

Approved for continued synthetic-data local beta testing. Not approved for real patient data or a national production claim until every unchecked production/external gate above has an accountable owner, evidence, and sign-off. The detailed 23 August decision is in `PRE_BETA_RELEASE_GATE_2026-08-23.md`.
