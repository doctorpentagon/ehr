// Operational workflows for the five Awibi Diagnostics service lines.
// These describe accountable human work. They do not allow AI or a generic
// status update to bypass specimen/image quality, specialist review or release.

const WORKFLOWS = {
  IMAGING: {
    id: 'IMAGING',
    label: 'Imaging & Radiology',
    reportFields: ['Technique', 'Comparison', 'Findings', 'Impression', 'Recommendation'],
    steps: [
      ['identity-safety', 'Verify identity, request and safety', 'Confirm identifiers, indication, pregnancy/contrast/MRI safety and required preparation.'],
      ['protocol-schedule', 'Protocol and schedule study', 'Radiologist/department selects the protocol; technologist confirms modality, slot and preparation.'],
      ['acquire-images', 'Acquire and quality-check images', 'Radiographer or sonographer acquires labelled images and confirms diagnostic quality before the patient leaves.'],
      ['pacs-store', 'Store/link the study', 'Send images to PACS or the facility image archive and retain a retrievable study link/accession number.'],
      ['specialist-report', 'Radiologist reports', 'Radiologist reviews the complete study, prior imaging and clinical question, then records findings and impression.'],
      ['verify-release', 'Verify, communicate and release', 'Sign the report, communicate urgent findings, release to the care team/patient and retain the audit trail.'],
    ],
  },
  HAEMATOLOGY: {
    id: 'HAEMATOLOGY',
    label: 'Haematology',
    reportFields: ['Specimen quality', 'Measured values', 'Film/morphology', 'Interpretation', 'Critical communication'],
    steps: [
      ['identity-safety', 'Verify identity and request', 'Confirm identifiers, clinical question, anticoagulant requirements and collection timing.'],
      ['collect-label', 'Collect and label blood/specimen', 'Use the correct tube, bedside labelling, collection time and collector identity.'],
      ['accession-quality', 'Accession and specimen quality check', 'Receive, barcode and assess clots, fill volume, haemolysis and rejection criteria.'],
      ['analyse-morphology', 'Analyse and review morphology', 'Run validated analyser/QC; perform film, differential, coagulation or specialist review as indicated.'],
      ['validate-result', 'Validate result', 'Review flags, delta checks, reference intervals and authorize the result at the appropriate competency level.'],
      ['communicate-release', 'Communicate and release', 'Escalate critical values with read-back, release the result and document acknowledgement/clinical review.'],
    ],
  },
  CHEMICAL_PATHOLOGY: {
    id: 'CHEMICAL_PATHOLOGY',
    label: 'Chemical Pathology',
    reportFields: ['Specimen quality', 'Analytes and units', 'Reference interval', 'Interpretation', 'Critical communication'],
    steps: [
      ['identity-safety', 'Verify identity, request and preparation', 'Confirm fasting/timing, medicines, collection conditions and the clinical question.'],
      ['collect-label', 'Collect and label specimen', 'Use the correct container, bedside labelling, collection time and handling conditions.'],
      ['accession-prepare', 'Accession and prepare specimen', 'Receive, barcode, centrifuge/aliquot where required and record haemolysis, icterus or lipaemia.'],
      ['analyse-qc', 'Analyse with quality control', 'Confirm calibration and internal QC acceptability before patient results are accepted.'],
      ['validate-interpret', 'Validate and interpret', 'Apply units, reference/critical limits, delta checks and chemical pathology interpretation.'],
      ['communicate-release', 'Communicate and release', 'Escalate critical values with read-back, release the result and retain review evidence.'],
    ],
  },
  MICROBIOLOGY: {
    id: 'MICROBIOLOGY',
    label: 'Microbiology',
    reportFields: ['Specimen/source', 'Microscopy', 'Culture/identification', 'Susceptibility', 'Interpretation/infection-control alert'],
    steps: [
      ['identity-safety', 'Verify identity, request and source', 'Confirm anatomical source, collection before antimicrobials, clinical syndrome and biosafety needs.'],
      ['collect-transport', 'Collect, label and transport', 'Use aseptic technique, correct container/transport medium, time and temperature.'],
      ['accession-primary', 'Accession and primary examination', 'Receive, barcode, assess acceptability and perform microscopy/stain or direct tests where indicated.'],
      ['culture-identify', 'Inoculate, incubate and identify', 'Select media/conditions, document growth and identify significant organisms.'],
      ['susceptibility', 'Perform susceptibility testing', 'Use the validated method and current interpretive standard; detect important resistance mechanisms.'],
      ['validate-alert', 'Validate, alert and release', 'Interpret clinical significance, notify critical/infection-control findings and issue preliminary/final reports.'],
    ],
  },
  HISTOPATHOLOGY: {
    id: 'HISTOPATHOLOGY',
    label: 'Histopathology & Morbid Anatomy',
    reportFields: ['Specimen/procedure', 'Gross description', 'Microscopy', 'Diagnosis/synoptic dataset', 'Comment/staging'],
    steps: [
      ['identity-consent', 'Verify identity, request and consent', 'Confirm patient/deceased identifiers, procedure/site, laterality, fixation time and required consent.'],
      ['accession-track', 'Accession and track specimen', 'Assign accession/barcode, reconcile containers/forms and preserve chain of custody.'],
      ['gross-fix', 'Gross examination and fixation', 'Describe, measure, ink/orient, sample and document fixation; for morbid anatomy record the authorized examination plan.'],
      ['process-section', 'Process, embed, section and stain', 'Track cassettes/blocks/slides and complete H&E or required special stains with quality checks.'],
      ['microscopy-ancillary', 'Microscopy and ancillary studies', 'Pathologist reviews slides and requests deeper levels, IHC, molecular tests or consultation when needed.'],
      ['diagnose-synoptic', 'Diagnose and complete structured report', 'Record diagnosis, grading/staging and applicable synoptic dataset; reconcile clinicopathological context.'],
      ['verify-release', 'Sign out, communicate and archive', 'Authorize the report, communicate urgent/unexpected findings and retain blocks, slides and digital images.'],
    ],
  },
};

function normalizeDiscipline(value = '') {
  const text = String(value).trim().toUpperCase();
  if (['IMAGING', 'RADIOLOGY'].includes(text)) return 'IMAGING';
  if (['HAEMATOLOGY', 'HEMATOLOGY'].includes(text)) return 'HAEMATOLOGY';
  if (['CHEMISTRY', 'CHEMICAL PATHOLOGY', 'CHEMICAL_PATHOLOGY'].includes(text)) return 'CHEMICAL_PATHOLOGY';
  if (['MICROBIOLOGY', 'PARASITOLOGY', 'SEROLOGY'].includes(text)) return 'MICROBIOLOGY';
  if (['HISTOPATHOLOGY', 'MORBID ANATOMY', 'ANATOMICAL PATHOLOGY', 'HISTOPATHOLOGY_MORBID_ANATOMY'].includes(text)) return 'HISTOPATHOLOGY';
  return null;
}

function workflowKeyFor(request = {}) {
  if (request.testType === 'IMAGING' || request.testType === 'ECG') return 'IMAGING';
  return normalizeDiscipline(request.diagnosticDiscipline);
}

function publicWorkflow(workflow) {
  if (!workflow) return null;
  return {
    id: workflow.id,
    label: workflow.label,
    reportFields: workflow.reportFields,
    steps: workflow.steps.map(([key, title, detail], index) => ({ key, title, detail, sequence: index + 1 })),
  };
}

function workflowFor(request) {
  return publicWorkflow(WORKFLOWS[workflowKeyFor(request)]);
}

function validateWorkflowPrefix(workflow, completedStepKeys) {
  if (!workflow || !Array.isArray(completedStepKeys)) return false;
  const expected = workflow.steps.map((step) => step.key);
  if (new Set(completedStepKeys).size !== completedStepKeys.length) return false;
  return completedStepKeys.every((key, index) => key === expected[index]);
}

function listWorkflows() {
  return Object.values(WORKFLOWS).map(publicWorkflow);
}

module.exports = { listWorkflows, normalizeDiscipline, workflowFor, workflowKeyFor, validateWorkflowPrefix };
