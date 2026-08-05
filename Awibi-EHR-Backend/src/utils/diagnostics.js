// Investigation lifecycle and result interpretation.

// ORDERED -> ACCEPTED -> COLLECTED -> IN_PROGRESS -> PRELIMINARY -> COMPLETED
// with CORRECTED and CANCELLED as terminal branches. PENDING is the stored name
// for "ordered" so existing rows stay valid.
const TRANSITIONS = {
  PENDING:     ['ACCEPTED', 'COLLECTED', 'IN_PROGRESS', 'CANCELLED'],
  ACCEPTED:    ['COLLECTED', 'IN_PROGRESS', 'CANCELLED'],
  COLLECTED:   ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PRELIMINARY', 'COMPLETED', 'CANCELLED'],
  PRELIMINARY: ['COMPLETED', 'CORRECTED', 'CANCELLED'],
  COMPLETED:   ['CORRECTED'],
  CORRECTED:   ['CORRECTED'],
  CANCELLED:   [],
};

function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

function transitionError(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return `Cannot move an investigation from ${from} to ${to}.` +
    (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This is a terminal state.');
}

/**
 * Interpret a numeric result against its reference range.
 * Critical thresholds take precedence over the ordinary reference range.
 * Returns { abnormalFlag, isCritical } — nulls when there is nothing to compare.
 */
function interpretResult(value, { referenceLow, referenceHigh, criticalLow, criticalHigh } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return { abnormalFlag: null, isCritical: false };
  }
  const v = Number(value);

  if (criticalLow != null && v <= Number(criticalLow)) return { abnormalFlag: 'CRITICAL_LOW', isCritical: true };
  if (criticalHigh != null && v >= Number(criticalHigh)) return { abnormalFlag: 'CRITICAL_HIGH', isCritical: true };
  if (referenceLow != null && v < Number(referenceLow)) return { abnormalFlag: 'LOW', isCritical: false };
  if (referenceHigh != null && v > Number(referenceHigh)) return { abnormalFlag: 'HIGH', isCritical: false };
  if (referenceLow == null && referenceHigh == null) return { abnormalFlag: null, isCritical: false };
  return { abnormalFlag: 'NORMAL', isCritical: false };
}

module.exports = { TRANSITIONS, canTransition, transitionError, interpretResult };
