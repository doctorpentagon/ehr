/**
 * Resuscitation protocols, as checklists.
 *
 * These are prompts for people who already know the algorithm and are working
 * under pressure — not teaching material and not decision support. Each step is
 * one tap, with the usual dose pre-filled, because the failure mode in an arrest
 * is not knowing what to give, it is losing track of what has already been given
 * and when.
 *
 * Doses are standard adult values. A team can deviate; the record captures what
 * was actually done, not what the protocol said.
 */

const PROTOCOLS = [
  {
    key: 'ACLS',
    label: 'Adult cardiac arrest (ACLS)',
    appliesTo: ['CODE_BLUE'],
    // Repeat intervals matter more than the list: adrenaline every 3–5 minutes
    // and a rhythm check every 2 minutes are the things teams lose track of.
    steps: [
      { action: 'Start CPR', detail: '30:2, minimise interruptions', critical: false },
      { action: 'Attach defibrillator / monitor', critical: false },
      { action: 'Rhythm check', repeatEveryMins: 2, critical: false },
      { action: 'Defibrillate', meta: { joules: 200 }, critical: true, confirm: 'Confirm shock — is everyone clear?' },
      { action: 'Adrenaline 1 mg IV', meta: { drug: 'Adrenaline', dose: '1 mg', route: 'IV' }, repeatEveryMins: 4 },
      { action: 'Amiodarone 300 mg IV', meta: { drug: 'Amiodarone', dose: '300 mg', route: 'IV' }, detail: 'After the 3rd shock' },
      { action: 'Secure airway', detail: 'Supraglottic or ETT' },
      { action: 'IV / IO access' },
      { action: 'Consider reversible causes', detail: '4 Hs and 4 Ts' },
      { action: 'ROSC achieved', critical: false, endsEvent: true },
    ],
  },
  {
    key: 'SEPSIS_6',
    label: 'Sepsis Six (within one hour)',
    appliesTo: ['SEPSIS_ALERT', 'RAPID_RESPONSE'],
    // The whole point of this bundle is the hour. The board shows time elapsed
    // against that hour rather than a plain stopwatch.
    targetMins: 60,
    steps: [
      { action: 'Give high-flow oxygen', meta: { target: 'SpO2 94-98%' } },
      { action: 'Take blood cultures', detail: 'Before antibiotics if it does not delay them' },
      { action: 'Give IV antibiotics', detail: 'Per local formulary', critical: true },
      { action: 'Give IV fluids', meta: { fluid: '0.9% Normal Saline', dose: '500 mL bolus' } },
      { action: 'Check serum lactate' },
      { action: 'Monitor urine output', detail: 'Hourly, catheterise if needed' },
    ],
  },
  {
    key: 'RAPID_RESPONSE',
    label: 'Deteriorating patient',
    appliesTo: ['RAPID_RESPONSE', 'OTHER'],
    steps: [
      { action: 'Airway assessed' },
      { action: 'Breathing — rate and saturation recorded' },
      { action: 'Circulation — pulse and BP recorded' },
      { action: 'Disability — GCS and glucose recorded' },
      { action: 'Exposure — full examination' },
      { action: 'Senior review requested', critical: true },
      { action: 'Escalation plan agreed' },
    ],
  },
];

function protocolFor(key) {
  return PROTOCOLS.find((p) => p.key === key) || null;
}

function protocolsForType(type) {
  return PROTOCOLS.filter((p) => p.appliesTo.includes(type));
}

/**
 * Steps that are due again, given what has already been logged.
 *
 * An arrest runs long and the team loses track of intervals — this is the part
 * a person cannot reliably do while performing chest compressions.
 */
function dueRepeats(protocolKeys, entries, nowOffsetSeconds) {
  const due = [];
  for (const key of protocolKeys || []) {
    const protocol = protocolFor(key);
    if (!protocol) continue;
    for (const step of protocol.steps) {
      if (!step.repeatEveryMins) continue;
      const matching = entries.filter((e) => e.action === step.action);
      if (matching.length === 0) continue;
      const lastOffset = Math.max(...matching.map((e) => e.timeOffsetSeconds));
      const dueAt = lastOffset + step.repeatEveryMins * 60;
      if (nowOffsetSeconds >= dueAt) {
        due.push({
          action: step.action,
          meta: step.meta || {},
          lastGivenSecondsAgo: nowOffsetSeconds - lastOffset,
          overdueBySeconds: nowOffsetSeconds - dueAt,
        });
      }
    }
  }
  return due;
}

module.exports = { PROTOCOLS, protocolFor, protocolsForType, dueRepeats };
