// tests/komal/rules.mjs — the branch-routing and allocation rules Komal must
// follow, extracted from .dsh/skills/patient-intake.md as PURE functions.
//
// The scenarios contract-test these against hand-computed expectations from
// the documented spec. If the skill changes, update these functions and the
// scenario expectations together.

// City → branch codes (multi-branch cities list both).
export const CITY_BRANCHES = {
  Lahore: ['LHR-YA', 'LHR-12K'],
  Karachi: ['KHI-SM', 'KHI-PT'],
  Islamabad: ['ISB-DC', 'ISB-BV'],
  Multan: ['MUX-01'],
  Faisalabad: ['FSD-01'],
  Sialkot: ['SKT-01'],
  Gujrat: ['GRT-01'],
};

// Non-surgical (hair units/patches/pieces/systems) go to the designated hub
// in the three major cities; every other city's branch is multi-specialty.
const NON_SURGICAL_HUB = { Lahore: 'LHR-12K', Karachi: 'KHI-PT', Islamabad: 'ISB-BV' };

/** Normalise a patient-stated procedure to one of the intake enums. */
export function procedureEnum(procedure) {
  const map = {
    hair_transplant: 'hair_transplant',
    transplant: 'hair_transplant',
    fue: 'fue',
    fut: 'fue',
    dhi: 'fue',
    prp: 'prp',
    'hair system': 'non_surgical',
    'hair unit': 'non_surgical',
    'hair patch': 'non_surgical',
    'hair piece': 'non_surgical',
    nonsurgical: 'non_surgical',
    non_surgical: 'non_surgical',
  };
  return map[String(procedure).toLowerCase()] ?? null;
}

/** Surgical = transplant / FUE / FUT / DHI / PRP / other clinical bookings. */
export function isSurgical(procedure) {
  const p = procedureEnum(procedure);
  return p !== null && p !== 'non_surgical';
}

/**
 * The documented routing rules. Returns { branchCode, reason }.
 * @param {string} city           e.g. 'Lahore'
 * @param {string} procedure      patient-stated, e.g. 'hair_transplant'
 * @param {number|string} lastTwoDigits  last two digits of the patient's phone
 */
export function route(city, procedure, lastTwoDigits) {
  const p = procedureEnum(procedure);
  if (!p) return { branchCode: null, reason: `unknown procedure "${procedure}"` };
  const key = String(city).charAt(0).toUpperCase() + String(city).slice(1).toLowerCase();
  const n = Number(lastTwoDigits);

  // No city yet (missing-data flow): no routing until the patient tells us.
  if (!CITY_BRANCHES[key]) return { branchCode: null, reason: `unknown city "${city}" — ask the patient` };

  // Non-surgical → designated hub, or the local multi-specialty branch.
  if (!isSurgical(p)) {
    const hub = NON_SURGICAL_HUB[key];
    return {
      branchCode: hub ?? CITY_BRANCHES[key]?.[0],
      reason: hub ? `non-surgical → ${hub} (hub)` : `non-surgical → local branch ${CITY_BRANCHES[key]?.[0]}`,
    };
  }

  // Karachi PRP: 100% → SMCHS (overrides the 65/35 surgical split).
  if (p === 'prp' && key === 'Karachi') {
    return { branchCode: 'KHI-SM', reason: 'Karachi PRP → KHI-SM (100%)' };
  }

  if (key === 'Lahore') {
    const code = n % 4 === 3 ? 'LHR-12K' : 'LHR-YA';
    return { branchCode: code, reason: `Lahore surgical 75/25 → ${code} (${n} % 4 = ${n % 4})` };
  }
  if (key === 'Karachi') {
    const code = n % 20 < 13 ? 'KHI-SM' : 'KHI-PT';
    return { branchCode: code, reason: `Karachi surgical 65/35 → ${code} (${n} % 20 = ${n % 20})` };
  }
  if (key === 'Islamabad') {
    const code = n % 4 === 3 ? 'ISB-BV' : 'ISB-DC';
    return { branchCode: code, reason: `Islamabad surgical 75/25 → ${code} (${n} % 4 = ${n % 4})` };
  }

  const local = CITY_BRANCHES[key]?.[0];
  return { branchCode: local, reason: `surgical → local branch ${local}` };
}

/**
 * Enum value safe to STORE in leads.interested_procedure.
 * The migration-versioned enum is ('fue','fut','dhi','prp','gfc','mesotherapy','other');
 * 'hair_transplant' / 'non_surgical' exist only via live-DB drift (see tests/README.md).
 */
export function storeProcedure(procedure) {
  const p = procedureEnum(procedure);
  if (p === 'hair_transplant') return 'fue';
  if (p === 'non_surgical') return 'other';
  return p;
}
