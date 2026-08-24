import React, { useState } from 'react';
import { AlertTriangle, Baby, UserRound } from 'lucide-react';
import { bmiFromCentimetres, calculatePediatricBmi } from '@/lib/pediatricBmi';

const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60_000));
  return local.toISOString().slice(0, 10);
};

const adultBand = (bmi) => {
  if (bmi < 16) return 'Severe thinness';
  if (bmi < 17) return 'Moderate thinness';
  if (bmi < 18.5) return 'Mild thinness';
  if (bmi < 25) return 'Normal range';
  if (bmi < 30) return 'Overweight';
  if (bmi < 35) return 'Obesity class I';
  if (bmi < 40) return 'Obesity class II';
  return 'Obesity class III';
};

function Field({ id, label, unit, children, note }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label} {unit && <span className="font-normal text-gray-400">({unit})</span>}
      </label>
      {children}
      {note && <p className="text-xs text-gray-500 mt-1">{note}</p>}
    </div>
  );
}

const inputClass = 'w-full min-h-11 px-3 border border-gray-300 rounded-lg text-sm bg-white';

export default function BmiCalculatorPanel() {
  const [mode, setMode] = useState('adult');
  const [adult, setAdult] = useState({ weightKg: '', heightCm: '' });
  const [child, setChild] = useState({
    weightKg: '', heightCm: '', sex: '', birthDate: '', measurementDate: today(),
    measurementMethod: 'age_appropriate',
  });
  const [outcome, setOutcome] = useState(null);

  const chooseMode = (next) => {
    setMode(next);
    setOutcome(null);
  };

  const updateAdult = (key) => (event) => {
    setAdult((current) => ({ ...current, [key]: event.target.value }));
    setOutcome(null);
  };

  const updateChild = (key) => (event) => {
    setChild((current) => ({ ...current, [key]: event.target.value }));
    setOutcome(null);
  };

  const calculate = () => {
    if (mode === 'child') {
      setOutcome(calculatePediatricBmi(child));
      return;
    }
    const bmi = bmiFromCentimetres(adult.weightKg, adult.heightCm);
    const problems = [];
    const weight = Number(adult.weightKg);
    const height = Number(adult.heightCm);
    if (!Number.isFinite(weight) || weight < 1 || weight > 400) problems.push('Enter a weight from 1 to 400 kg.');
    if (!Number.isFinite(height) || height < 30 || height > 250) problems.push('Enter height from 30 to 250 cm.');
    if (!Number.isFinite(bmi) || problems.length) setOutcome({ ok: false, problems });
    else setOutcome({ ok: true, bmi: Number(bmi.toFixed(1)), classification: adultBand(bmi) });
  };

  return (
    <section className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">BMI assessment</h3>
          <p className="text-xs text-gray-500 mt-0.5">Height is entered in centimetres.</p>
        </div>
        <div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label="BMI reference group">
          <button
            type="button"
            onClick={() => chooseMode('adult')}
            className={`min-h-9 px-3 rounded-md text-sm font-medium flex items-center gap-1.5 ${mode === 'adult' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
          >
            <UserRound size={15} /> Adult
          </button>
          <button
            type="button"
            onClick={() => chooseMode('child')}
            className={`min-h-9 px-3 rounded-md text-sm font-medium flex items-center gap-1.5 ${mode === 'child' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
          >
            <Baby size={15} /> Child / adolescent
          </button>
        </div>
      </div>

      {mode === 'adult' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="adult-bmi-weight" label="Weight" unit="kg">
            <input id="adult-bmi-weight" className={inputClass} type="number" inputMode="decimal" min="1" max="400" step="any"
              value={adult.weightKg} onChange={updateAdult('weightKg')} placeholder="e.g. 70" />
          </Field>
          <Field id="adult-bmi-height" label="Height" unit="cm">
            <input id="adult-bmi-height" className={inputClass} type="number" inputMode="decimal" min="30" max="250" step="any"
              value={adult.heightCm} onChange={updateAdult('heightCm')} placeholder="e.g. 175" />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="child-bmi-weight" label="Weight" unit="kg">
            <input id="child-bmi-weight" className={inputClass} type="number" inputMode="decimal" min="1" max="300" step="any"
              value={child.weightKg} onChange={updateChild('weightKg')} placeholder="e.g. 24" />
          </Field>
          <Field id="child-bmi-height" label="Height or length" unit="cm">
            <input id="child-bmi-height" className={inputClass} type="number" inputMode="decimal" min="30" max="250" step="any"
              value={child.heightCm} onChange={updateChild('heightCm')} placeholder="e.g. 122" />
          </Field>
          <Field id="child-bmi-sex" label="WHO reference sex" note="WHO BMI-for-age reference values are sex-specific.">
            <select id="child-bmi-sex" className={inputClass} value={child.sex} onChange={updateChild('sex')}>
              <option value="">Choose…</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </Field>
          <Field id="child-bmi-dob" label="Date of birth">
            <input id="child-bmi-dob" className={inputClass} type="date" max={child.measurementDate || today()}
              value={child.birthDate} onChange={updateChild('birthDate')} />
          </Field>
          <Field id="child-bmi-date" label="Measurement date">
            <input id="child-bmi-date" className={inputClass} type="date" max={today()}
              value={child.measurementDate} onChange={updateChild('measurementDate')} />
          </Field>
          <Field id="child-bmi-method" label="How height was measured">
            <select id="child-bmi-method" className={inputClass} value={child.measurementMethod} onChange={updateChild('measurementMethod')}>
              <option value="age_appropriate">Age-appropriate / not sure</option>
              <option value="lying">Lying length</option>
              <option value="standing">Standing height</option>
            </select>
          </Field>
        </div>
      )}

      <button type="button" onClick={calculate}
        className="mt-4 w-full sm:w-auto min-h-11 px-6 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium">
        Calculate
      </button>

      {outcome && !outcome.ok && (
        <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
          <ul className="text-sm text-amber-900 space-y-1">
            {outcome.problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </div>
      )}

      {outcome?.ok && mode === 'adult' && (
        <div className="mt-3 border border-[#2D5BFF]/30 bg-[#2D5BFF]/5 rounded-lg p-4">
          <div className="text-xs text-gray-600">Adult BMI</div>
          <div className="text-2xl font-bold text-gray-900 tabular-nums">
            {outcome.bmi}<span className="text-base font-normal text-gray-500 ml-1">kg/m²</span>
          </div>
          <div className="text-sm font-medium text-gray-800 mt-1">{outcome.classification}</div>
        </div>
      )}

      {outcome?.ok && mode === 'child' && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="border border-[#2D5BFF]/30 bg-[#2D5BFF]/5 rounded-lg p-3">
              <div className="text-xs text-gray-600">BMI</div>
              <div className="text-xl font-bold text-gray-900 tabular-nums">{outcome.bmi} <span className="text-sm font-normal text-gray-500">kg/m²</span></div>
            </div>
            <div className="border border-[#2D5BFF]/30 bg-[#2D5BFF]/5 rounded-lg p-3">
              <div className="text-xs text-gray-600">BMI-for-age z-score</div>
              <div className="text-xl font-bold text-gray-900 tabular-nums">{outcome.zScore > 0 ? '+' : ''}{outcome.zScore} SD</div>
            </div>
            <div className="border border-[#2D5BFF]/30 bg-[#2D5BFF]/5 rounded-lg p-3">
              <div className="text-xs text-gray-600">WHO percentile</div>
              <div className="text-base font-semibold text-gray-900 mt-1">{outcome.percentile}</div>
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <div className="text-sm font-semibold text-gray-900">{outcome.classification.label}</div>
            <p className="text-xs text-gray-600 mt-1">
              {outcome.referenceGroup === 'WHO_2006_0_5'
                ? 'WHO Child Growth Standards (birth to 5 years)'
                : 'WHO Growth Reference 2007 (5 to 19 years)'} · reference age {outcome.referenceAge}
            </p>
            {outcome.heightAdjustment && <p className="text-xs text-blue-700 mt-1">{outcome.heightAdjustment}</p>}
          </div>
          <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-900">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <p>Screening result only. Confirm measurements, review the child’s growth trend and clinical context, and follow local paediatric guidance. Do not place a young child on a restrictive diet from this result alone.</p>
          </div>
        </div>
      )}
    </section>
  );
}
