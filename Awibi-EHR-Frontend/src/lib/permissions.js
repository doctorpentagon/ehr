export const PERMISSIONS = {
  // Must stay in sync with Awibi-EHR-Backend/src/utils/permissions.js —
  // the backend enforces these, this map only renders the sidebar.
  // ADMIN = facility owner: sees everything in their facility, but does not
  // author signed clinical content (no clinical_write/prescriptions_write).
  SUPER_ADMIN: { overview:1, patients:1, cases:1, appointments:1, lab:1, departments:1, staff:1, affiliates:1, billing:1, subscription:1, reports:1, settings:1, admissions:1, beds:1, orders:1, support:1, patient_demographics_write:1,
                 nursing:1, monitoring:1, drug_admin:1, handover:1, growth:1, bookings:1, emergency:1, households:1,
                 // Cross-facility platform oversight belongs to Awibi staff only.
                 platform:1 },
  ADMIN:       { overview:1, patients:1, cases:1, appointments:1, lab:1, departments:1, staff:1, affiliates:1, billing:1, subscription:1, reports:1, settings:1, admissions:1, beds:1, orders:1, support:1, patient_demographics_write:1,
                 nursing:1, monitoring:1, drug_admin:1, handover:1, growth:1, bookings:1, emergency:1, households:1 },
  RECORDS:     { overview:1, patients:1, appointments:1, settings:1, support:1, patient_demographics_write:1, bookings:1, emergency:1, households:1 },
  CLINICIAN:   { overview:1, settings:1, support:1 },
};

const SUB_ROLE_EXTRAS = {
  // Doctors read the nursing record and can ask for a correction, but do not
  // author observations — an observation says a named person was at the bedside.
  // `monitoring_review` replaces `monitoring_write` here; keep this matching the
  // backend or the UI offers buttons the API refuses.
  DOCTOR:     { patients:1, cases:1, appointments:1, lab:1, reports:1, prescriptions:1, orders:1, vitals_write:1, clinical_write:1, prescriptions_write:1,
                nursing:1, monitoring:1, monitoring_review:1, drug_admin:1, handover:1, growth:1, growth_write:1, emergency:1, emergency_write:1, households:1 },
  NURSE:      { patients:1, cases:1, appointments:1, lab:1, admissions:1, beds:1, orders:1, vitals:1, vitals_write:1,
                nursing:1, monitoring:1, monitoring_write:1, drug_admin:1, drug_admin_write:1, handover:1, handover_write:1, growth:1, growth_write:1, emergency:1, emergency_write:1 },
  LAB:        { lab:1, transfer:1 },
  PHARMACIST: { patients:1, prescriptions:1, billing:1 },
};

export function can(role, subRole, module) {
  // A null module means "open to any signed-in member of staff" — used by
  // Messages, where gating a nurse out of telling a doctor something would
  // defeat the point of having it.
  if (module == null) return true;
  const base = PERMISSIONS[role] || {};
  const extras = subRole ? (SUB_ROLE_EXTRAS[subRole] || {}) : {};
  return !!(base[module] || extras[module]);
}

// section: groups items visually in the sidebar
export const NAV_ITEMS = [
  { key: 'overview',     label: 'Overview',        icon: 'LayoutDashboard', path: '/dashboard',              section: 'General', end: true },
  // Reference and calculators. key:null means every signed-in role sees it —
  // a nurse checking a drip rate needs it as much as a consultant does.
  { key: null,           label: 'Scout',            icon: 'Compass',         path: '/dashboard/scout',        section: 'Clinical' },
  { key: 'patients',     label: 'Patients',         icon: 'Users',           path: '/dashboard/patients',     section: 'Clinical' },
  { key: 'appointments', label: 'Appointments',     icon: 'Calendar',        path: '/dashboard/appointments', section: 'Clinical' },
  // "Cases" matches the clinical language used in the designs and on the ward.
  { key: 'cases',        label: 'Cases',            icon: 'FileText',        path: '/dashboard/cases',        section: 'Clinical' },
  { key: 'lab',          label: 'Diagnostics',      icon: 'FlaskConical',    path: '/dashboard/lab',          section: 'Clinical' },
  { key: 'admissions',   label: 'Admissions',       icon: 'BedDouble',       path: '/dashboard/admissions',   section: 'Clinical' },
  { key: 'emergency',    label: 'Emergency',        icon: 'AlertTriangle',   path: '/dashboard/emergency',    section: 'Clinical' },
  { key: 'bookings',     label: 'Booking requests', icon: 'CalendarCheck',   path: '/dashboard/bookings',     section: 'Clinical' },
  { key: 'patients',     label: 'Enquiries',        icon: 'MessageSquare',   path: '/dashboard/inquiries',    section: 'Clinical' },
  { key: 'monitoring',   label: 'Monitoring',       icon: 'Activity',        path: '/dashboard/nursing',      section: 'Nursing' },
  { key: 'drug_admin',   label: 'Drug chart',       icon: 'Pill',            path: '/dashboard/nursing/drug-chart', section: 'Nursing' },
  { key: 'handover',     label: 'Shift report',     icon: 'ClipboardList',   path: '/dashboard/nursing/shift-report',   section: 'Nursing' },
  { key: 'drug_admin',   label: 'Task worklist',    icon: 'ListChecks',      path: '/dashboard/nursing/worklist',   section: 'Nursing' },
  // The worklist answers "what is due now"; standing orders answer "what was
  // instructed and is it actually happening". Different questions, different screens.
  { key: 'orders',       label: 'Standing orders',  icon: 'ClipboardCheck',  path: '/dashboard/nursing/orders',     section: 'Nursing' },
  // Every member of staff can message colleagues — a nurse who cannot tell a
  // doctor something is the problem this solves, so there is no gating key.
  { key: null,           label: 'Messages',         icon: 'MessageCircle',   path: '/dashboard/messages',     section: 'Clinical' },
  { key: 'departments',  label: 'Departments',      icon: 'Building2',       path: '/dashboard/departments',  section: 'Admin' },
  { key: 'staff',        label: 'Staff',            icon: 'UserCog',         path: '/dashboard/staff',        section: 'Admin' },
  { key: 'affiliates',   label: 'Affiliates',       icon: 'BuildingSkyscraper', path: '/dashboard/affiliates', section: 'Admin' },
  { key: 'billing',      label: 'Billing',          icon: 'Receipt',         path: '/dashboard/billing',      section: 'Admin' },
  { key: 'households',   label: 'Households',       icon: 'Users2',          path: '/dashboard/households',   section: 'Admin' },
  { key: 'billing',      label: 'Insurance',        icon: 'ShieldCheck',     path: '/dashboard/insurance',    section: 'Admin' },
  { key: 'platform',     label: 'Platform',         icon: 'BuildingSkyscraper', path: '/dashboard/platform',            section: 'Platform' },
  { key: 'platform',     label: 'Facilities',       icon: 'Building2',       path: '/dashboard/platform/facilities', section: 'Platform' },
  { key: 'platform',     label: 'Subscriptions',    icon: 'CreditCard',      path: '/dashboard/platform/subscriptions', section: 'Platform' },
  { key: 'platform',     label: 'Clinical billing', icon: 'Receipt',         path: '/dashboard/platform/payments',      section: 'Platform' },
  { key: 'reports',      label: 'Reports',          icon: 'BarChart3',       path: '/dashboard/reports',      section: 'System' },
  { key: 'subscription', label: 'Subscription',     icon: 'CreditCard',      path: '/dashboard/subscription', section: 'System' },
  { key: 'departments',  label: 'Encounter types',  icon: 'ClipboardList',   path: '/dashboard/settings/encounter-types', section: 'Admin' },
  { key: 'settings',     label: 'Settings',         icon: 'Settings',        path: '/dashboard/settings',     section: 'System' },
  { key: 'support',      label: 'Help & Support',   icon: 'HelpCircle',      path: '/dashboard/support',      section: 'System' },
];

// Role labels shown to users. The stored sub-role is LAB, but the person doing
// that job runs both laboratory investigations and imaging, so every screen
// calls them Diagnostics. Keep display names here so login, sidebar, staff list
// and profile can never drift apart.
const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN:       'Facility Admin',
  RECORDS:     'Records Officer',
  CLINICIAN:   'Clinician',
  DOCTOR:      'Doctor',
  NURSE:       'Nurse',
  LAB:         'Diagnostics',
  PHARMACIST:  'Pharmacist',
};

/** The single label to show for a user: sub-role when present, else role. */
export function roleLabel(role, subRole) {
  const key = (subRole || role || '').toUpperCase();
  return ROLE_LABELS[key] || key.replaceAll('_', ' ').toLowerCase();
}

/** Longer form for profile headers: "Diagnostics · UCH Ibadan Demo". */
export function roleDescription(role, subRole) {
  const base = roleLabel(role, subRole);
  if (subRole && role === 'CLINICIAN') return base;
  return base;
}
