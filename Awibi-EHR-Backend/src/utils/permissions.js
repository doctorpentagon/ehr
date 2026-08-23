// Single source of truth for RBAC.
// Used by both the API middleware (enforcement) and the frontend nav (rendering).
const PERMISSIONS = {
  SUPER_ADMIN: {
    // Awibi staff operate the platform; they are not an elevated member of a
    // hospital workforce. Tenant middleware independently refuses this role on
    // every facility route, while these permissions keep the UI equally narrow.
    platform: 1, settings: 1, support: 1,
  },
  // ADMIN is the facility owner (hospital/lab proprietor): full visibility and
  // administration of everything inside their own facility. Authoring signed
  // clinical content (clinical_write / prescriptions_write / vitals_write) stays
  // with licensed clinical roles — an owner who is also a clinician should be
  // given the matching CLINICIAN sub-role rather than widening ADMIN.
  ADMIN: {
    overview: 1, patients: 1, cases: 1, appointments: 1, lab: 1,
    departments: 1, staff: 1, billing: 1, subscription: 1, reports: 1,
    settings: 1, affiliates: 1, admissions: 1, beds: 1, orders: 1,
    pharmacy: 1, inventory_write: 1,
    patient_demographics_write: 1,
    nursing: 1, monitoring: 1, drug_admin: 1, handover: 1, growth: 1, bookings: 1,
    emergency: 1, emergency_write: 1, households: 1,
  },
  RECORDS: {
    overview: 1, patients: 1, appointments: 1, settings: 1, support: 1,
    patient_demographics_write: 1,
    // Reception reviews online booking requests, starts emergency intake and
    // maintains household groupings.
    bookings: 1, emergency: 1, emergency_write: 1, households: 1,
  },
  CLINICIAN: {
    overview: 1, settings: 1, support: 1,
    // Clinical access is assigned by sub-role below.
  },
};

// Sub-role extras merged at runtime
const SUB_ROLE_EXTRAS = {
  // A monitoring sheet is the nursing record. Doctors read all of it and can ask
  // for a correction through `monitoring_review`, but they do not author the
  // observation itself — so it stays unambiguous who was at the bedside and saw
  // what. Owner decision, 4 August 2026.
  // Admission and discharge are medical decisions. Doctors held no `admissions`
  // permission at all, so a patient could be admitted by a nurse and then never
  // discharged by the person who decides they are fit to go home — the ward
  // filled up and the bed board stopped reflecting the ward.
  DOCTOR:  { patients: 1, cases: 1, appointments: 1, lab: 1, diagnostic_order: 1, reports: 1, prescriptions: 1, orders: 1, vitals_write: 1, clinical_write: 1, prescriptions_write: 1,
             nursing: 1, monitoring: 1, monitoring_review: 1, drug_admin: 1, handover: 1, growth: 1, growth_write: 1,
             emergency: 1, emergency_write: 1, households: 1 },
  // Nursing is the nurse's own documentation domain: monitoring sheets, the
  // medication administration record, growth charts and shift handover.
  NURSE:   { patients: 1, cases: 1, appointments: 1, lab: 1, admissions: 1, beds: 1, orders: 1, vitals: 1, vitals_write: 1,
             nursing: 1, monitoring: 1, monitoring_write: 1, drug_admin: 1, drug_admin_write: 1,
             handover: 1, handover_write: 1, growth: 1, growth_write: 1, emergency: 1, emergency_write: 1 },
  LAB:     { lab: 1, diagnostic_process: 1, transfer: 1 },
  RADIOLOGIST: { lab: 1, diagnostic_process: 1, transfer: 1 },
  RADIOGRAPHER: { lab: 1, diagnostic_process: 1, transfer: 1 },
  HAEMATOLOGIST: { lab: 1, diagnostic_process: 1, transfer: 1 },
  CHEMICAL_PATHOLOGIST: { lab: 1, diagnostic_process: 1, transfer: 1 },
  HISTOPATHOLOGIST: { lab: 1, diagnostic_process: 1, transfer: 1 },
  MICROBIOLOGIST: { lab: 1, diagnostic_process: 1, transfer: 1 },
  PHARMACIST: { patients: 1, prescriptions: 1, pharmacy: 1, pharmacy_write: 1, inventory_write: 1, billing: 1 },
};

function can(role, subRole, module) {
  const base = PERMISSIONS[role] || {};
  const extras = (role === 'CLINICIAN' && subRole) ? (SUB_ROLE_EXTRAS[subRole] || {}) : {};
  return !!(base[module] || extras[module]);
}

function getPermissions(role, subRole) {
  const base = PERMISSIONS[role] || {};
  const extras = (role === 'CLINICIAN' && subRole) ? (SUB_ROLE_EXTRAS[subRole] || {}) : {};
  return { ...base, ...extras };
}

module.exports = { can, getPermissions, PERMISSIONS };
