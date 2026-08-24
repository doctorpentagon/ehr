# Awibi EHR production architecture decisions

Decision date: 23 August 2026 (Africa/Lagos)

This document separates what the current application actually does from the infrastructure and assurance required before real clinical production. It is not a compliance certificate.

## 1. Monitoring initiation and ownership

There are deliberately two initiation paths and one observation owner:

1. **Doctor order:** Clinical → Orders & prescriptions → Nursing care / monitoring → patient ID → instruction, goal, chart type, frequency and priority. The order enters Nursing as “Ordered monitoring awaiting a chart”.
2. **Nurse initiation:** Nursing → Monitoring → Start monitoring → patient ID → template/custom fields, frequency and instructions. This covers clinically necessary bedside monitoring when a separate order is not yet available.
3. **Nurse observation:** only nursing staff create the bedside observation. Doctors read the chart, review the trend, acknowledge alerts and request recheck/correction; they do not impersonate the observer.

Every chart and observation stores the authenticated professional and server time. A justified retrospective clinical time is separate from the immutable EHR entry time.

## 2. Realtime communication: necessary, but never the source of truth

Current implementation uses durable database rows and polling (unread messages every 60 seconds). That is acceptable for a synthetic beta and ordinary messages. It is not the final design for time-critical clinical alerts.

Production decision:

- The database transaction creates the clinical event, notification/outbox row and audit evidence first.
- A worker publishes the committed event to the intended facility/user channels.
- Socket.IO or Server-Sent Events accelerates the display; it does not replace the database record.
- Every event has an ID, recipient, facility, created time, expiry, severity and acknowledgement state.
- On reconnect, the client sends its last event offset and fetches missed durable events.
- Critical alerts require escalation rules and an acknowledged human response. A socket badge must never replace verbal/telephone emergency escalation or the facility protocol.

Why: Socket.IO guarantees ordering, but its default delivery is **at most once**. Its own guidance requires application-level persistence, unique event IDs and offset-based recovery for stronger delivery. Connection recovery can also fail, so the client must resynchronise from the server.

Recommended rollout:

1. Keep polling during the beta; reduce only the critical-alert interval after load testing.
2. Add a transactional notification outbox and acknowledgement API.
3. Add Socket.IO with authenticated facility/user rooms, expiry and reconnect resync.
4. When horizontally scaled, use Redis Streams rather than ephemeral in-memory broadcast.
5. Test disconnect, duplicate, reordering, expired session, revoked user and multi-device acknowledgement.

References: [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [connection recovery](https://socket.io/docs/v4/connection-state-recovery/).

## 3. Authentication, JWS/JWT, RBAC and web security

### Current verified controls

- bcrypt password hashing at cost 12.
- 15-minute access JWT and rotating seven-day refresh token.
- Refresh token in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` in production.
- Production secret startup guards, login/reset rate limits, Helmet headers and an explicit production CORS allowlist.
- Backend permission middleware, authenticated facility context and exact-record tenant tests. Frontend RBAC is only presentation; the API is the enforcement point.
- Prisma query APIs are used; no unsafe raw SQL execution was found in the current source scan.
- React escapes ordinary rendered text; no `dangerouslySetInnerHTML`, `eval` or `new Function` use was found in the application source scan.

### Important gaps before live patient use

- The access token is still stored in browser `localStorage`; any successful XSS in the origin can read it. OWASP explicitly notes this risk.
- PostgreSQL RLS is not implemented. Current isolation is application-layer filtering and must not be described as database RLS.
- Complete PHI-read auditing, MFA/step-up, privileged access management, central secret/KMS rotation, independent penetration testing, dependency/SBOM scanning and production header/TLS evidence remain open.
- Rich-text HTML, if introduced, needs a strict schema/allowlist and a proven sanitizer. React escaping alone does not make arbitrary HTML safe.

### Token decision

JWT is a token format; its signed representation is normally a JWS. A JWS provides integrity/authenticity, **not confidentiality**. Do not put diagnoses or other PHI in token claims.

For the Awibi web application, prefer a server-managed session or short-lived access token held in memory plus a `Secure`, `HttpOnly`, host-only refresh/session cookie with CSRF protection, rotation and revocation. For external FHIR clients, use OAuth 2.0/OIDC/SMART scopes; use asymmetric signed tokens with `iss`, `aud`, `exp`, `iat`, `jti`, key IDs and a controlled JWKS rotation only where independently verifiable tokens are required.

### Security release gate

- Exact CORS origins; never `*` with credentials.
- TLS 1.2+ at the load balancer and database; HSTS after domain verification.
- Contextual output encoding, strict CSP, no unsafe HTML sinks, validated URLs/uploads and malware scanning.
- Prisma parameterisation plus allowlisted sort/filter fields; least-privilege database role; no runtime migration/owner privilege.
- MFA for administrators and privileged clinical operations; short idle timeout and explicit device/session revocation.
- RLS pilot using a transaction-local facility context, `FORCE ROW LEVEL SECURITY`, a non-owner application role and cross-tenant negative tests. PostgreSQL documents that owners and `BYPASSRLS` roles otherwise bypass policies.
- SAST, dependency and secret scanning in CI; DAST/API authorization tests and independent penetration testing before live care.

References: [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [JWT guidance](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html), [XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [SQL injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html), [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## 4. Production database and hosting decision

### Database

Keep **PostgreSQL**. Prisma is the ORM, not a competing database. Use PostgreSQL 16 or 17 initially after confirming Prisma/extension compatibility; do not upgrade major versions merely because a newer one exists.

For a national/continental system, use a managed production database rather than a PostgreSQL container on the same machine as the API:

- **Recommended cloud baseline:** Amazon RDS for PostgreSQL Multi-AZ in `af-south-1` (Cape Town), subject to the approved data-residency/DPIA decision. The region currently has three Availability Zones and supports PostgreSQL Multi-AZ clusters.
- Private database subnets, no public endpoint, KMS encryption, TLS, deletion protection, automated backups/PITR, cross-account immutable backup copy, CloudWatch alarms and quarterly restore drills.
- Separate EHR and Awibi Identity databases, database users, keys, backups and network boundaries.
- Start with one logical multi-tenant EHR database only while application isolation and the RLS migration are proven. Large sovereign/enterprise customers can later use a dedicated database/cell without changing the product model.

RDS Multi-AZ automatically fails over to another Availability Zone and saves automated backups; point-in-time recovery restores into a new database. These features still require Awibi to test recovery and define RPO/RTO.

References: [RDS regions](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html), [PostgreSQL Multi-AZ availability](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.MultiAZDBClusters.html), [Multi-AZ failover](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts-failover.html), [RDS backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ManagingAutomatedBackups.html).

### Application/server

Docker packages the application; it is not itself a hosting or high-availability plan.

- Containerise the EHR API, Identity API and AI worker separately.
- Run at least two API tasks across Availability Zones behind an HTTPS Application Load Balancer. ECS Fargate is a sensible managed starting point; private subnets prevent direct inbound Internet access to tasks.
- Store documents in encrypted private object storage, never the container filesystem. Use short-lived authorised downloads, versioning and retention/Object Lock where governance requires it.
- Put database migrations in a one-off deployment job, not in every API replica startup.
- Centralise logs without clinical payloads; add metrics, traces, alerting and an audited break-glass support process.

For hospitals with unreliable Internet, add a governed facility edge deployment: local server, UPS, encrypted disks, local LAN access and an idempotent store-and-forward synchronisation service. Do not call browser caching “offline EHR”.

References: [ECS private subnet guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html), [ECS load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html), [S3 encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html), [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).

## 5. FHIR, openEHR and clinical data standards

Current truth: the Prisma schema is a useful internal clinical model. It is **not yet a conformant FHIR server**, and storing similar concepts does not make it openEHR archetyped data.

Decision:

- Use **FHIR R4** as the first external exchange contract because of its stable ecosystem and SMART-on-FHIR support.
- Keep the internal operational schema; add a versioned mapping/export layer rather than renaming database tables to FHIR resources.
- First profiles: Patient, RelatedPerson, Practitioner/PractitionerRole, Organization/Location, Encounter, Observation, Condition, AllergyIntolerance, MedicationRequest/MedicationDispense/MedicationAdministration, ServiceRequest, Specimen, DiagnosticReport, ImagingStudy, DocumentReference, Appointment, CarePlan, Consent, Provenance and AuditEvent.
- Publish CapabilityStatement, StructureDefinitions, value sets, terminology bindings, search rules, version policy and conformance tests.
- Use SMART scopes/OAuth for application access. FHIR itself does not supply authentication, authorization or audit collection.
- Evaluate openEHR only as a deliberate clinical repository/model-governance programme. Its archetypes/templates and AQL are valuable, but claiming “convertible to openEHR” requires explicit archetype/template mappings, validation and round-trip tests.

References: [FHIR R4 REST API](https://hl7.org/fhir/R4/http.html), [SMART App Launch](https://hl7.org/fhir/smart-app-launch/), [openEHR specifications](https://specifications.openehr.org/), [openEHR REST API](https://specifications.openehr.org/releases/ITS-REST/latest/).

## 6. Speech-to-text and handwriting-to-text before Awibi models exist

### Recommended speech stack

1. **faster-whisper** with multilingual Whisper `small`/`medium` for the first private server-side prototype. It is MIT licensed, supports CPU/GPU quantisation, VAD and word timestamps; the project reports lower memory and up to four-times faster inference than the reference implementation under its benchmark settings.
2. Keep **OpenAI Whisper** as the reference implementation and accuracy baseline. Whisper is MIT licensed, multilingual and has sizes from tiny to turbo/large with documented memory trade-offs.
3. Consider **Vosk** only for a very light offline/live preview on weak hardware; it supports offline streaming and small models. Final clinical extraction should still use the validated higher-accuracy pipeline.

The browser transcript remains a preview. Audio is sent to the isolated Clinical AI service, transcribed, transformed into the six structured headings, returned as a proposal and deleted according to policy. A clinician must review every heading before saving.

References: [Whisper](https://github.com/openai/whisper), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Vosk](https://github.com/alphacep/vosk-api).

### Recommended handwriting/document stack

1. Preprocess: orientation, perspective correction, denoise, contrast and page/line segmentation.
2. **PaddleOCR** for page layout, printed text, tables and confidence/bounding boxes.
3. **Microsoft TrOCR handwritten** for cropped handwritten text lines. Its published models are line recognisers trained/evaluated on datasets such as IAM, so full-page clinical notes still need segmentation and local validation.
4. Add a Nigerian clinical lexicon only as a suggestion/reranking layer; never silently “correct” a medicine, dose, unit, negation or laterality.
5. Return source regions, recognised text and confidence. Highlight low-confidence words next to the original image for clinician correction.

References: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [Microsoft TrOCR](https://github.com/microsoft/unilm/tree/master/trocr), [TrOCR handwritten model](https://huggingface.co/microsoft/trocr-base-handwritten).

### Required local validation

- Build consented/de-identified Nigerian test sets across accents, specialties, noisy wards, low-cost phones, cursive styles and clinical abbreviations.
- Measure speech word error rate plus medication/dose/unit/negation/entity accuracy; measure OCR character/word error rate and the same critical-field accuracy.
- Test hallucination, omissions, code-switching, names, paediatric decimals, allergies and laterality.
- Set confidence thresholds and require manual entry when they are missed.
- Never auto-sign, diagnose, order, administer, or save an AI proposal.

## 7. Recommended implementation order

1. Complete secure-session migration, RLS design/test harness and complete read auditing.
2. Produce versioned database migration and AWS threat model/IaC for the synthetic staging environment.
3. Add transactional notification outbox and acknowledged critical-alert delivery before sockets.
4. Deploy faster-whisper + PaddleOCR/TrOCR behind the existing Clinical AI adapter with no autonomous writes.
5. Run Nigerian clinical validation and physical-device/network testing.
6. Build FHIR R4 profiles/mappings and conformance tests; do not claim FHIR/openEHR compliance before that evidence exists.
7. Complete independent privacy, security, clinical-safety, recovery and interoperability assurance before live care.
