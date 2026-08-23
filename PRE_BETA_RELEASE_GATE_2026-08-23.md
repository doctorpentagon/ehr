# Awibi EHR pre-beta interoperability, identity, security, and offline release gate

Audit date: 23 August 2026 (Africa/Lagos)

Audience: product owner, facility beta lead, Awibi engineering, clinical safety owner, data protection owner, security reviewer, diagnostics lead, and QA collaborator.

## Decision

Awibi may continue a **controlled synthetic-data beta** next week. It must not use real patient data or be represented as country-ready, fully interoperable, fully offline, PACS-enabled, enterprise-MPI complete, or legally certified.

The current system is strongest in facility-scoped clinical workflows: structured consultation-to-order transactions, named/time-stamped clinical attribution, signed immutable consultation notes, diagnostics result versioning, critical-alert closure, nursing monitoring, and explicit EHR-to-Identity result release. The largest remaining risks are cross-branch portability, enterprise patient matching, production offline safety, complete access auditing, production deployment assurance, and imaging integration.

Legend: **PASS** = implemented with local evidence; **PARTIAL** = useful implementation exists but the stated outcome is not complete; **BLOCKER** = do not claim or use in real clinical production; **EXTERNAL** = requires organisational/vendor/regulatory action.

## 1. Interoperability and branch continuity

| Check | Status | Evidence and decision |
|---|---|---|
| Universal Awibi patient identifier | PASS | EHR stores a globally unique UPID and retains a separate facility hospital number/MRN. |
| Pairwise facility-to-Identity link | PASS | Each facility relationship has a separate opaque pairwise identifier and consent state. |
| Result delivery to the citizen Identity inbox | PASS | Only final, explicitly released, consented diagnostic reports are delivered with source/version provenance. |
| Branch A chart automatically available in Branch B | BLOCKER | Not implemented. `Facility` has no parent organisation/network model and clinical records remain facility-scoped. A common UPID helps identify the person but does not grant access or move the chart. |
| Multi-branch organisation administration | BLOCKER | Add `Organization`, `FacilityMembership`, branch policy, staff assignment, network consent, shared-vs-local record rules, and network audit reporting. |
| Standards-based clinical exchange | BLOCKER | No production FHIR endpoint/conformance statement, terminology service, consent enforcement gateway, or exchange agreement exists. |
| Patient record export/import | BLOCKER | Define FHIR R4/R5 profiles and test at minimum Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationRequest, ServiceRequest, DiagnosticReport, DocumentReference, Consent, Provenance, and AuditEvent. |
| Cross-branch emergency access | BLOCKER | Requires a break-glass policy, purpose/reason, minimum necessary view, patient notification, expiry, and immutable audit trail. |

**Architecture decision:** do not put every branch inside one unrestricted tenant. Keep each facility's operational record independently controlled. Introduce an organisation/network layer and a policy-enforced exchange service. The UPID or continuity code locates identity; authorization, consent/lawful basis, purpose of use, role, relationship, and audit decide what may be shared.

## 2. Master Patient Index (MPI) and duplicate integrity

| Check | Status | Evidence and decision |
|---|---|---|
| Unique UPID and facility MRN constraints | PASS | Implemented in Prisma. |
| Exact UPID/MRN lookup | PASS | Implemented and facility-scoped. |
| Ambiguous shared-phone handling | PASS | Multiple candidates are returned for human selection; a phone number is not silently treated as unique identity. |
| Emergency temporary-record merge | PASS | Clinical child records are moved to the selected permanent facility patient with audit evidence. |
| Prevent two Identity accounts linking to one facility record incorrectly | PASS | Identity service refuses conflicting same-facility links and directs duplicate/merge review. |
| Probabilistic enterprise matching | BLOCKER | No scored match engine using verified name, DOB, sex, phone, address, identifiers, phonetic/transliteration rules, and data quality exists. |
| Duplicate review work queue | BLOCKER | Needs certain/probable/possible match grades, side-by-side demographics, evidence, reviewer attribution, SLA, and no automatic merge below the approved threshold. |
| Golden-record survivorship and unmerge | BLOCKER | Define authoritative-source rules, correction propagation, link/merge/unmerge, deceased status, disputed identity, twins, newborn/unnamed babies, guardians/dependants, and fraud flags. |
| Cross-system MPI API | BLOCKER | Implement a profiled FHIR `Patient/$match` contract and merge/link notifications; a UPID generator alone is not an MPI. |

## 3. Database independence and Awibi oversight

| Check | Status | Evidence and decision |
|---|---|---|
| Prisma versus PostgreSQL clarified | PASS | Prisma is the ORM. PostgreSQL is the database. Supabase or Render can host PostgreSQL; using Prisma does not mean Supabase is absent or present. |
| Facility logical isolation | PASS | Clinical queries use authenticated facility context and exact-record tenant guards; cross-facility tests exist. |
| Physical database per facility | PARTIAL | Current EHR is shared-database multi-tenancy, not a separate physical database for every hospital. Independence is logical. |
| Separate EHR and Identity databases | PASS | The product design requires separate databases, sessions, and secrets. |
| Awibi super-admin clinical access | PASS | Hardened on 23 August: platform operators are refused by tenant middleware on all facility clinical routes, even if a demo account has a facility attached. |
| Awibi aggregate oversight | PASS | Platform routes expose facilities, subscriptions, aggregate activity, and clinical billing oversight to `SUPER_ADMIN`. |
| Database RLS | BLOCKER | Prisma filters are application-layer tenancy. PostgreSQL row-level security is not implemented/tested and must not be claimed. |
| Backups and restore evidence | EXTERNAL | Provision encrypted backups, point-in-time recovery where required, restore drills, RPO/RTO, regional failure procedures, and independent evidence. |

## 4. Security, protection, and compliance

| Check | Status | Evidence and decision |
|---|---|---|
| Password hashing | PASS | bcrypt with cost 12. |
| Production secret startup guards | PASS | Production refuses known development JWT/shared-secret defaults. |
| Hosted passwordless demo gate | PASS | Hosted demo requires explicit danger acknowledgement and now refuses startup without an access code of at least 16 characters. Synthetic data only. |
| Exposed demo/admin credential | BLOCKER | Treat every credential shown in a status, chat, screenshot, or repository as compromised. Rotate it before beta; never reuse local demo credentials in hosted or production environments. |
| Platform/tenant separation | PASS | Platform operators are blocked from tenant clinical surfaces and routed to the Platform workspace. |
| CORS and headers | PASS | Explicit production origin allowlist, Helmet, and rate limiting are present. Deployment must still verify actual headers/TLS. |
| Access-token storage | BLOCKER | The access token is stored in browser `localStorage`, increasing impact of an XSS flaw. Move toward short-lived sender-constrained or secure-cookie sessions with CSRF protection and tested revocation. |
| Complete PHI read audit | BLOCKER | Selected writes and platform views are audited; not every clinical read/query/download is proven to be recorded. |
| Tamper-evident audit retention | BLOCKER | Add append-only/WORM or cryptographically chained export, clock monitoring, central alerting, retention, and restricted audit-reader roles. |
| MFA and privileged access | BLOCKER | Require phishing-resistant MFA for Awibi and facility admins, step-up authentication for exports/role changes, just-in-time access, and reviewed break-glass. |
| Data-at-rest encryption/KMS | EXTERNAL | Verify managed-database, object-store, backup, workstation, and offline-device encryption with key ownership/rotation evidence. |
| NDPA compliance claim | BLOCKER | Do not claim certification. Complete DPIA, lawful-basis/purpose map, notices, processor contracts, retention/deletion/legal-hold rules, data-subject processes, breach plan, DPO/legal review, and independent assurance. |
| Penetration and dependency testing | EXTERNAL | Run SAST, secret scanning, dependency/SBOM review, DAST/API authorization tests, independent penetration test, and remediation sign-off. |

## 5. Consultation and four multimodal inputs

| Check | Status | Evidence and decision |
|---|---|---|
| Typed consultation | PASS | Manual structured SOAP input and structured questionnaire capture exist. |
| Questionnaire without checkbox-only distortion | PASS | Questionnaire sections accept clinically appropriate text, selections, and structured fields rather than reducing history to indiscriminate checkboxes. |
| Voice capture UI | PARTIAL | Recording/upload and an AI proposal-review flow exist. Actual transcription requires the separately configured Awibi Clinical AI service. |
| Image/handwriting/PDF capture UI | PARTIAL | Upload and OCR proposal-review flow exist. Actual extraction requires the configured Clinical AI service and has not been independently validated across handwriting, lighting, accents, noise, and low-end devices. |
| Clinician review before chart insertion | PASS | AI output is a proposal; the clinician reviews/edits before saving. Source audio/image is not retained by the EHR endpoint. |
| Real-time and saved recording | PARTIAL | Browser capture/upload is present; device permissions, saved-file formats, interruptions, and physical Android testing remain open. |
| Atomic consultation-to-order transaction | PASS | A consultation can create the case, medication, nursing order, and diagnostic order as one transaction; invalid nested data rolls back. |
| Automatic professional/date/time | PASS | Authenticated author and server timestamp are stored. Retrospective care time is distinct and requires reason/late-entry handling after migration verification. |
| Clinical signing | PASS | Named electronic attestation and immutable signed note exist. A pasted image of a handwritten signature is not equivalent to a cryptographic digital signature and is not recommended as the primary control. |
| Cryptographic non-repudiation | BLOCKER | Add standards-based signature/provenance only after certificate/key custody, canonicalisation, versioning, co-sign, correction, and legal policy are approved. |

## 6. Nursing monitoring and visual review

| Check | Status | Evidence and decision |
|---|---|---|
| Custom monitoring sheets | PASS | Nurse-entered fields and templates support numeric, text, choice, and checklist observations. |
| Voice/snap proposal for nursing | PARTIAL | UI/API path exists and is constrained to the sheet's allowed fields; depends on external Clinical AI configuration and validation. |
| Value-versus-time chart | PASS | Line charts show time, target band, critical thresholds, severity-coloured points, latest value, trend, and abnormal count. This is more suitable than a generic bar chart for clinical trends. |
| Doctor access to monitoring | PASS | Doctors can view the trend and request nursing correction/recheck without authoring the bedside observation. |
| Critical monitoring lifecycle | PASS | Server thresholds, deduplicated alert episodes, acknowledgement/action/resolution, and attribution exist. |
| Clinical validation of every monitoring template | EXTERNAL | Facility clinical owners must approve units, ranges, frequency, escalation, age/pregnancy context, and protocols. |

## 7. Diagnostics, radiology, and PACS

| Check | Status | Evidence and decision |
|---|---|---|
| Doctor initiates diagnostic order | PASS | Doctors order from consultation/patient clinical actions; diagnostic staff process their scoped work queue. |
| Specialist areas | PASS | Roles/queues cover general laboratory, radiology, radiography, haematology, chemical pathology, histopathology/morbid anatomy, and microbiology. Catalogue includes X-ray, ultrasound, CT, MRI, mammography, Doppler, fluoroscopy, ECG/other workflows. |
| Specimen/imaging state machines | PASS | Laboratory collection and imaging/non-specimen flows differ appropriately; result verification cannot be bypassed by a status-only update. |
| Preliminary/final/corrected reports | PASS | Versioned reporting, clinician review reset on correction, and critical result lifecycle exist. |
| PACS/VNA storage | BLOCKER | No production image archive is integrated. The EHR must not pretend report attachments are a PACS. |
| DICOM modality worklist | BLOCKER | No patient/order worklist sends correct identity to CT/MRI/X-ray/ultrasound equipment, so manual-entry/bypass risk remains. |
| In-EHR diagnostic viewer | BLOCKER | Integrate an approved PACS/VNA/viewer through DICOMweb search/retrieve and store stable study identifiers, not expiring arbitrary URLs. |
| Imaging metadata contract | BLOCKER | Store accession number, Study/Series/SOP Instance UIDs, modality, body part, acquisition time, performer, facility, report version, and viewer authorization mapping. |
| Nigerian low-connectivity fallback | BLOCKER | Define local edge cache/store-and-forward, lossless retry, storage monitoring, CD/film import policy, reconciliation, and downtime SOP without making workstation disks the only archive. |
| Diagnostic monitor and QA | EXTERNAL | Radiology lead must approve diagnostic display, calibration, hanging protocols, compression, retention, peer review, and reporting governance. |

Recommended radiology flow: clinician `ServiceRequest` → accession/scheduling → modality worklist → radiographer/sonographer acquires images with verified patient/order identity → PACS/VNA stores DICOM study → radiologist reads through diagnostic viewer → preliminary/final/corrected report → EHR `DiagnosticReport` links the study → ordering clinician reviews/acts → consented final report is optionally released to Awibi Identity. The PACS holds images; the EHR holds order, report, clinical review, provenance, and authorized link.

## 8. Offline operation

| Check | Status | Evidence and decision |
|---|---|---|
| App shell/static assets offline | PASS | Service worker caches the shell/assets and never caches API responses. |
| Facility/user queue isolation | PASS | Queued mutations are owner-scoped by authenticated user and facility; a different user cannot replay them. |
| Token retained in queue | PASS | The access token is not stored with queued payloads. |
| Full offline EHR | BLOCKER | Patient charts, consultations, medication safety, diagnostics, and conflict-safe clinical work are not broadly available offline. |
| Offline payload encryption | BLOCKER | IndexedDB queue payloads are not encrypted. Do not place sensitive real-patient drafts in it for beta. |
| Exactly-once/idempotent replay | BLOCKER | Add server-issued idempotency keys and database constraints for every offline-capable mutation. |
| Conflict resolution | BLOCKER | Add record versions, stale-write refusal, human conflict review, correction workflow, and audit evidence. |
| Device loss/retention/remote wipe | BLOCKER | Define expiry, secure deletion, device registration, revocation, remote wipe where possible, and MDM/on-prem policy. |
| Recommended deployment for poor networks | PARTIAL | Near term: reliable LAN/on-prem edge server with UPS, encrypted local database, encrypted replication, monitored outbox/inbox, and explicit downtime SOP. Do not use a generic cache write-back strategy for clinical truth. |

## 9. Minimum actions before next week's synthetic beta

- [ ] 1. Rotate every admin/demo password or access code that appeared in a screenshot, status, message, shared document, or terminal recording.
- [ ] 2. Keep `LOCAL_DEMO_ACCESS` off in every production process.
- [ ] 3. If using hosted `DEMO_MODE`, use invented patients only, set a unique 16+ character `DEMO_ACCESS_CODE`, and share it privately with named testers.
- [ ] 4. Put the beta behind an allowlist, VPN, or equivalent restricted access where practical.
- [ ] 5. Create named QA accounts with minimum roles; do not share one administrator account.
- [ ] 6. Confirm the new super-admin tenant-denial tests pass.
- [ ] 7. Apply the local Prisma schema to the disposable beta database and rerun all EHR/Identity tests.
- [ ] 8. Run exact cross-facility direct-ID probes with data present in both facilities.
- [ ] 9. Run duplicate scenarios: same phone, name spelling variation, same DOB, twins, unnamed newborn, temporary emergency record, wrong Identity link, merge and correction.
- [ ] 10. Clearly tell testers that branch-to-branch chart travel is a planned capability, not a currently completed one.
- [ ] 11. Test consultation save/sign/order rollback, retrospective event time, and immutable signed-note correction.
- [ ] 12. Test all four capture modes; mark Voice/Snap unavailable unless the Clinical AI service and microphone/camera are actually configured.
- [ ] 13. Use scripted synthetic recordings/images only; do not upload real patient material.
- [ ] 14. Test nurse monitoring trends, target bands, critical alert, acknowledgement, action, resolution, and doctor recheck request.
- [ ] 15. Test diagnostics per role across lab, imaging, haematology, chemical pathology, histopathology, and microbiology.
- [ ] 16. Demonstrate radiology report workflow honestly; label PACS/DICOM viewer integration as pending.
- [ ] 17. Test corrected diagnostic report creates a fresh clinician-review obligation and critical episode when appropriate.
- [ ] 18. Verify file downloads cannot cross facilities and storage paths are not exposed.
- [ ] 19. Verify platform exports contain no unnecessary patient identifiers.
- [ ] 20. Review CORS, TLS, headers, cookie flags, token lifetime, refresh/revocation, and login rate limits on the actual beta URL.
- [ ] 21. Run secret scanning and confirm no `.env`, database dump, raw feedback document, patient image, or private research source will enter Git.
- [ ] 22. Run frontend builds, backend unit/contract/smoke/loop/closure/role/tenancy tests, Identity unit/smoke/build, and browser workflow checks.
- [ ] 23. Record failures with severity, owner, reproducible steps, evidence, and retest result; do not silently check unfinished items.
- [ ] 24. Prepare a one-page tester script that distinguishes observation-only tasks from actions that create clinical data.
- [ ] 25. Prepare downtime cards: server unavailable, database unavailable, Identity unavailable, AI unavailable, and network lost.
- [ ] 26. Configure encrypted backups and perform at least one restore into an isolated test environment.
- [ ] 27. Name the clinical safety owner, DPO/privacy owner, security owner, MPI owner, diagnostics/PACS owner, and beta incident commander.
- [ ] 28. Publish beta support/escalation contacts and stop criteria for suspected data exposure or patient-safety defects.
- [ ] 29. Obtain explicit facility sign-off that all test data are synthetic and no live care depends on the beta.
- [ ] 30. Push only reviewed source and authored project documentation to the feature branch; exclude runtime folders, credentials, database dumps, raw feedback documents, and copyrighted research material.

## 10. Standards baseline for the design

- Nigeria Data Protection Act 2023: <https://ndpc.gov.ng/download/nigeria-data-protection-act-2023>
- Federal Ministry of Health direction toward a National Digital Health Architecture and “One Patient, One Health Record”: <https://health.gov.ng/fg-reaffirms-commitment-to-building-an-inclusive-digital-and-resilient-health-system/>
- HL7 FHIR Patient `$match`: <https://hl7.org/fhir/R4B/patient-operation-match.html>
- HL7 FHIR Patient `$everything`: <https://hl7.org/fhir/patient-operation-everything.html>
- HL7 FHIR security/privacy building blocks: <https://hl7.org/fhir/>
- DICOMweb and HL7 FHIR: <https://www.dicomstandard.org/using/dicomweb/dicomweb-and-hl7-fhir>

These are engineering baselines, not evidence that Awibi currently conforms. A conformance statement, tested profiles, governance, agreements, clinical validation, and independent assurance are still required.
