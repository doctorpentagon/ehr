/**
 * Awibi Scout — calculators.
 *
 * Every formula in the corpus is stored as a small expression tree, e.g. BMI:
 *
 *   { op: 'div', args: [ {op:'var',args:['weight']},
 *                        {op:'pow', args:[{op:'var',args:['height']},
 *                                         {op:'const',args:[2]}]} ] }
 *
 * Evaluated by walking that tree. Never with eval() or Function() — content is
 * data, and data that can execute is a way to run arbitrary code in a clinician's
 * browser. An unknown operator throws rather than guessing.
 *
 * These numbers are dosed against. A wrong answer is worse than no answer, so
 * anything uncertain refuses to produce a result instead of producing one that
 * looks authoritative.
 */

const OPS = {
  var: (args, vars) => {
    const key = args[0];
    const value = vars[key];
    if (value === undefined || value === null || value === '') {
      throw new MissingInput(key);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) throw new InvalidInput(key, value);
    return n;
  },
  const: (args) => Number(args[0]),
  add: (args, vars) => args.reduce((s, a) => s + evaluate(a, vars), 0),
  sum: (args, vars) => args.reduce((s, a) => s + evaluate(a, vars), 0),
  sub: (args, vars) => args.slice(1).reduce((s, a) => s - evaluate(a, vars), evaluate(args[0], vars)),
  mul: (args, vars) => args.reduce((p, a) => p * evaluate(a, vars), 1),
  div: (args, vars) => {
    const numerator = evaluate(args[0], vars);
    const denominator = evaluate(args[1], vars);
    // Division by zero silently yields Infinity in JavaScript, which would then
    // be rounded and displayed as a number. Refuse instead.
    if (denominator === 0) throw new CalculationError('Cannot divide by zero — check the inputs');
    return numerator / denominator;
  },
  pow: (args, vars) => evaluate(args[0], vars) ** evaluate(args[1], vars),
  min: (args, vars) => Math.min(...args.map((a) => evaluate(a, vars))),
  max: (args, vars) => Math.max(...args.map((a) => evaluate(a, vars))),
  abs: (args, vars) => Math.abs(evaluate(args[0], vars)),
  round: (args, vars) => Math.round(evaluate(args[0], vars)),
  floor: (args, vars) => Math.floor(evaluate(args[0], vars)),
  ceil: (args, vars) => Math.ceil(evaluate(args[0], vars)),
  // Conditional, for formulas that branch on sex or a threshold.
  if: (args, vars) => (evaluate(args[0], vars) ? evaluate(args[1], vars) : evaluate(args[2], vars)),
  gt: (args, vars) => (evaluate(args[0], vars) > evaluate(args[1], vars) ? 1 : 0),
  lt: (args, vars) => (evaluate(args[0], vars) < evaluate(args[1], vars) ? 1 : 0),
  eq: (args, vars) => (evaluate(args[0], vars) === evaluate(args[1], vars) ? 1 : 0),
};

export class MissingInput extends Error {
  constructor(key) { super(`Missing value: ${key}`); this.key = key; this.kind = 'missing'; }
}
export class InvalidInput extends Error {
  constructor(key, value) { super(`${key} is not a number`); this.key = key; this.value = value; this.kind = 'invalid'; }
}
export class CalculationError extends Error {
  constructor(message) { super(message); this.kind = 'calculation'; }
}

export function evaluate(node, vars) {
  if (node === null || node === undefined) throw new CalculationError('This calculator has no formula');
  if (typeof node === 'number') return node;
  if (typeof node === 'string') return OPS.var([node], vars);

  const handler = OPS[node.op];
  // Unknown operator means the content is newer than this build. Guessing would
  // be worse than saying so.
  if (!handler) throw new CalculationError(`This calculator needs a newer app version (unknown step: ${node.op})`);
  return handler(node.args || [], vars);
}

/** Half-up, so 2.5 rounds to 3 — what a person expects, unlike JavaScript's default. */
function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON) / factor;
}

/** The band a result falls in, e.g. BMI 27 → "Overweight". */
function findBand(bands, value) {
  if (!Array.isArray(bands)) return null;
  return bands.find((b) => {
    const aboveMin = b.min === null || b.min === undefined || value >= b.min;
    const belowMax = b.max === null || b.max === undefined || value < b.max;
    return aboveMin && belowMax;
  }) || null;
}

/**
 * Check inputs before computing.
 *
 * Ranges come from the content — a weight of 900 kg or a height of 0.02 m is a
 * typo, and a calculator that accepts it produces a confident, wrong answer.
 */
export function validateInputs(inputs, values) {
  const problems = [];
  for (const input of inputs || []) {
    const raw = values[input.key];
    const empty = raw === undefined || raw === null || raw === '';

    if (input.required && empty) {
      problems.push({ key: input.key, message: `${input.label} is needed`, kind: 'missing' });
      continue;
    }
    if (empty) continue;

    if (input.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        problems.push({ key: input.key, message: `${input.label} must be a number`, kind: 'invalid' });
        continue;
      }
      if (input.min !== null && input.min !== undefined && n < input.min) {
        problems.push({
          key: input.key,
          message: `${input.label} looks too low — expected at least ${input.min}${input.unit ? ` ${input.unit}` : ''}`,
          kind: 'range',
        });
      }
      if (input.max !== null && input.max !== undefined && n > input.max) {
        problems.push({
          key: input.key,
          message: `${input.label} looks too high — expected at most ${input.max}${input.unit ? ` ${input.unit}` : ''}`,
          kind: 'range',
        });
      }
    }
  }
  return problems;
}

/**
 * Can this entry compute, or does it only describe how?
 *
 * Most entries carry an expression tree. A handful carry `logic.note` instead —
 * the formula written out for a person to follow, usually because it branches
 * on sex or steps through weight bands in a way the tree format does not cover.
 * Those are worth showing, but not as a form with a Calculate button that can
 * never produce an answer.
 */
export function isComputable(entry) {
  return Boolean(entry && entry.logic && entry.logic.op);
}

export function writtenFormula(entry) {
  if (!entry || !entry.logic || entry.logic.op) return null;
  return entry.logic.note || null;
}

/**
 * Run an entry's calculator.
 *
 * Returns either results or problems, never a partial answer. A number on
 * screen is taken as correct, so it only appears when everything checks out.
 */
export function calculate(entry, values) {
  if (!isComputable(entry)) {
    const note = writtenFormula(entry);
    return {
      ok: false,
      notComputable: true,
      formula: note,
      problems: [{
        kind: 'reference-only',
        message: note
          ? 'This formula is provided for you to work through — it is not calculated here.'
          : 'This entry has no calculator.',
      }],
      results: [],
    };
  }

  const inputs = entry.inputs || [];
  const outputs = entry.outputs || [];

  const problems = validateInputs(inputs, values);
  if (problems.length) return { ok: false, problems, results: [] };

  // Unticked checkboxes are zero, not missing — a score of 0 is a real answer.
  const vars = {};
  for (const input of inputs) {
    const raw = values[input.key];
    if (input.type === 'boolean' || input.type === 'checkbox') vars[input.key] = raw ? 1 : 0;
    else if (raw === '' || raw === undefined || raw === null) vars[input.key] = null;
    else vars[input.key] = Number(raw);
  }

  try {
    const value = evaluate(entry.logic, vars);
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        problems: [{ message: 'That produced a result which is not a number — check the inputs', kind: 'calculation' }],
        results: [],
      };
    }

    // Most entries have one output; a few report several from the same formula.
    const results = (outputs.length ? outputs : [{ key: 'result', label: 'Result', decimals: 2 }]).map((output) => {
      const rounded = roundTo(value, output.decimals ?? 2);
      const band = findBand(output.bands, rounded);
      return {
        key: output.key,
        label: output.label || 'Result',
        value: rounded,
        unit: output.unit || null,
        band: band ? band.label : null,
        action: band ? band.action : null,
        interpretation: output.interpretation || null,
      };
    });

    return { ok: true, problems: [], results };
  } catch (err) {
    return {
      ok: false,
      problems: [{ key: err.key, message: err.message, kind: err.kind || 'calculation' }],
      results: [],
    };
  }
}
