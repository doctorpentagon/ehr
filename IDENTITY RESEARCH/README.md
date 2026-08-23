# Identity Research evidence register

This folder contains source research for Awibi's Identity/Veyra programme. The original Word and PDF files are preserved unchanged. The research informs product decisions; it does not itself prove legal compliance, technical conformance, clinical safety, trademark availability, or production readiness.

## Sources reviewed

1. `Awibi-Identity-Protocol.docx` — initial AHN, health-address, NIN-anchor, offline QR, matching, and emergency-capsule proposal.
2. `Awibi Veyra_ A Pan-African Health Continuity, Trust, Consent, and Cryptographic Infrastructure.docx` — deeper correction toward a continuity and trust fabric with pairwise identity, country federation, executable policy, a record locator, trust registry, and open-protocol/managed-network business model.
3. `Modular Research Report Template and Applied Blueprint for Awibi Scout.pdf` — a 50-page applied governance and delivery framework. Although its example is Scout, its evidence hierarchy, intended-use discipline, risk management, traceability, release gates, offline integrity, validation, monitoring, and checklist patterns apply directly to Identity.

All files were structurally extracted and reviewed. The PDF was rendered page-by-page and visually checked. The Word documents contain no embedded media; their contents were reviewed structurally because LibreOffice was unavailable in the local workspace runtime.

## Critical synthesis

The later Veyra research materially improves the first protocol and takes precedence where they conflict:

| Initial idea | Required correction |
| --- | --- |
| Universal AHN/UPID exposed across clinics | Internal random person ID plus organisation/domain/purpose-scoped pairwise identifiers |
| AHN as permanent interoperability key | Recovery/continuity code is a carrier and locator only; it grants no access and is not the clinical foreign key |
| Raw NIN or ordinary NIN field | Prefer authority-issued sector token/vNIN; otherwise a legally approved HSM/KMS protected keyed anchor; never plain hash or ordinary raw storage |
| One QR identity card | Separate, minimal, signed credentials for identity, emergency, insurance, and record-request purposes |
| Central signing key for offline issuance | Central HSM for connected issuance; constrained delegated hardware/device keys with scope, allowance, expiry, and chained audit for true offline issuance |
| Consent record | FHIR Consent representation plus policy decision and enforcement points, obligations, receipts, and non-consent lawful-basis handling |
| Patient registry | Continuity graph with evidence, assurance, provenance, reversibility, visibility, purpose, review status, and safety-governed matching |
| Continental database | Federated country trust domains with local law, keys, residency, anchors, and suspension authority |
| Proprietary protocol moat | Open specification, verifier, SDKs, schemas, test vectors, threat model, and conformance; commercial moat in safe managed operations and trust-network density |

## Decisions adopted

- Category: health continuity infrastructure, not a private national ID.
- Name: `Veyra` is provisional pending professional trademark, cultural, phonetic, medicine/device, domain, and multilingual review.
- Separation: Identity, EHR, and patient carriers are separate security and data domains joined only by versioned APIs/events.
- Inclusion: care and provisional identity must work without NIN, phone, smartphone, card, or connectivity.
- Privacy: no global relying-party identifier, public identity lookup, public blockchain identity metadata, hidden matching, advertising graph, or credit-scoring reuse.
- Safety: no irreversible merge, unexplained automatic match, stale emergency claim without warning, QR-as-authorization, or denial of care because assurance is low.
- Standards: reuse health and credential standards; Awibi owns the profile, trust operations, policy, conformance, offline behaviour, and country adapters—not novel cryptography.
- Delivery: govern first, then continuity core, trust registry, verifier, resolution, anchor gateway, consent enforcement, record locator, credentials, emergency capsule, sandbox/certification, and finally cross-border federation.

## Evidence status

As of 11 August 2026, primary-source checks confirmed the official State House announcement of the NIMC Act 2026, the NDPC's NDP Act/GAID publications, the Federal Ministry of Health's Nigeria Digital Health Initiative direction, NIMC material describing vNIN verification, W3C Verifiable Credentials 2.0, final OpenID4VP 1.0, OpenID4VCI 1.0, HL7 FHIR Consent/Provenance, OpenHIE Client Registry patterns, WebAuthn, and the relevant IETF cryptographic RFCs.

However:

- the full gazetted NIMC Act 2026 was not available in the research set and must be reviewed by Nigerian counsel before anchor design or claims are finalized;
- current NIMC vNIN/API eligibility, contracts, retention rules, permitted attributes, incident duties, and technical profiles require written confirmation from NIMC;
- NDPA/GAID duties, health-record lawful bases, minors/guardians, retention, emergency access, and cross-border transfers require a product-specific legal opinion and DPIA;
- no research source substitutes for regulator, clinical-safety, cryptographic, privacy, or independent security approval;
- `Veyra` must not be publicly launched until name clearance is complete.

## Outputs

The canonical build specification is maintained in [Awibi Identity documentation](../Awibi-Identity-Backend/docs/README.md).
