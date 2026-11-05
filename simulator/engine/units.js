// Unit parsing and conversion for doses and rates. Pure; no DOM.
// Amount units: g | mg | mcg (µg, ug) | units | %
// Rate units:  <amount>[/kg]/<min|h>, e.g. 'mcg/kg/min', 'mg/kg/h', 'mg/h'; or '%' (vaporizer dial).

const MASS_TO_MG = { g: 1000, mg: 1, mcg: 0.001, ug: 0.001, 'µg': 0.001, 'μg': 0.001 };

export function normAmountUnit(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim().toLowerCase().replace(/μ|µ/g, 'mc').replace(/^ug$/, 'mcg');
  if (s in MASS_TO_MG) return s === 'ug' ? 'mcg' : s;
  if (s === 'unit' || s === 'units' || s === 'u') return 'units';
  if (s === '%') return '%';
  return null;
}

export function convertAmount(value, from, to) {
  const f = normAmountUnit(from), tt = normAmountUnit(to);
  if (!f || !tt) throw new Error(`Unknown amount unit: ${!f ? from : to}`);
  if (f === tt) return value;
  if (f in MASS_TO_MG && tt in MASS_TO_MG) return value * MASS_TO_MG[f] / MASS_TO_MG[tt];
  throw new Error(`Cannot convert ${from} to ${to}`);
}

/** Parse e.g. 'mcg/kg/min' -> { amount:'mcg', perKg:true, time:'min' }; '%' -> { dial:true }. */
export function parseRateUnit(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim().toLowerCase().replace(/\s+/g, '').replace(/μ|µ/g, 'mc');
  if (s === '%') return { dial: true };
  const parts = s.split('/');
  if (parts.length < 2) return null;
  const amount = normAmountUnit(parts[0]);
  if (!amount || amount === '%') return null;
  let perKg = false; let rest = parts.slice(1);
  if (rest[0] === 'kg') { perKg = true; rest = rest.slice(1); }
  if (rest.length !== 1) return null;
  const tm = rest[0];
  const time = (tm === 'min' || tm === 'minute') ? 'min' : (tm === 'h' || tm === 'hr' || tm === 'hour') ? 'h' : null;
  if (!time) return null;
  return { amount, perKg, time };
}

/** Parse a per-kg dose unit like 'mg/kg' -> { amount:'mg', perKg:true }; 'mg' -> { amount:'mg', perKg:false }. */
export function parseDoseUnit(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim().toLowerCase().replace(/\s+/g, '');
  const parts = s.split('/');
  const amount = normAmountUnit(parts[0]);
  if (!amount) return null;
  if (parts.length === 1) return { amount, perKg: false };
  if (parts.length === 2 && parts[1] === 'kg') return { amount, perKg: true };
  return null;
}

/** Convert a rate to `amountUnit` per minute (absolute). weightKg used for per-kg units. */
export function rateToAmountPerMin(value, rateUnit, amountUnit, weightKg) {
  const r = parseRateUnit(rateUnit);
  if (!r || r.dial) throw new Error(`Not an amount rate unit: ${rateUnit}`);
  let v = convertAmount(value, r.amount, amountUnit);
  if (r.perKg) v *= weightKg;
  if (r.time === 'h') v /= 60;
  return v;
}

/** Convert between two amount-rate units (either may be per-kg). */
export function convertRate(value, from, to, weightKg) {
  if (from === to) return value;
  const a = parseRateUnit(from), b = parseRateUnit(to);
  if (!a || !b) throw new Error(`Unknown rate unit: ${!a ? from : to}`);
  if (a.dial || b.dial) { if (a.dial && b.dial) return value; throw new Error(`Cannot convert ${from} to ${to}`); }
  let v = convertAmount(value, a.amount, b.amount);
  if (a.perKg && !b.perKg) v *= weightKg;
  if (!a.perKg && b.perKg) v /= weightKg;
  if (a.time === 'h' && b.time === 'min') v /= 60;
  if (a.time === 'min' && b.time === 'h') v *= 60;
  return v;
}

export function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

/** Round to 3 significant figures (display-friendly, avoids float noise). */
export function round3(v) {
  if (!isFiniteNumber(v) || v === 0) return v;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  const p = Math.pow(10, 3 - d);
  return Math.round(v * p) / p;
}
