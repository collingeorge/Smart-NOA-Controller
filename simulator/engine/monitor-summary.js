const channels = {
  depthIndex: ['Processed EEG depth (BIS-style, simulated)', 'index'],
  tofRatio: ['Train-of-four ratio (TOFR)', 'ratio'],
  tofCount: ['Train-of-four count', '/4'],
  sbp: ['Systolic BP', 'mmHg'],
  dbp: ['Diastolic BP', 'mmHg'],
  map: ['Mean arterial pressure', 'mmHg'],
  hr: ['Heart rate', '/min'],
  spo2: ['SpO2', '%'],
  rr: ['Respiratory rate', '/min'],
  etco2: ['End-tidal CO2', 'mmHg'],
};

export function recordMonitorSample(totals, vitals, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  for (const id of Object.keys(channels)) {
    const value = vitals[id];
    if (!Number.isFinite(value) || (id === 'tofRatio' && vitals.tofCount !== 4)) continue;
    const row = totals[id] ??= { min: value, max: value, weighted: 0, seconds: 0 };
    row.min = Math.min(row.min, value);
    row.max = Math.max(row.max, value);
    row.weighted += value * seconds;
    row.seconds += seconds;
  }
}

export function summarizeMonitor(totals) {
  return Object.entries(channels).map(([id, [label, unit]]) => {
    const row = totals[id];
    return { id, label, unit, min: row?.min ?? null, mean: row ? row.weighted / row.seconds : null,
      max: row?.max ?? null, observedSec: row?.seconds ?? 0 };
  });
}
