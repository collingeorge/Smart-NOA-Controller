// Hand-written canvas trend charts (no libraries). Last 15 simulated minutes.
export const WINDOW_SEC = 15 * 60;

const COLORS = { grid: 'rgba(255,255,255,0.12)', axis: '#c9d6df', thresh: 'rgba(255,214,102,0.8)', bg: '#0b2232' };
export const SERIES_COLORS = ['#c1a36c', '#8fd3ff', '#b9f18c', '#f7a8d8', '#ffd479', '#c4b5fd'];

/**
 * drawChart(canvas, { t:[], series:[{label, color, data:[], dash?}], min, max, thresholds:[{v,label}], nowSec, unit })
 * NaN values (sensor fault) break the line.
 */
export function drawChart(canvas, cfg) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(120, canvas.clientWidth || canvas.parentElement.clientWidth || 300);
  const cssH = Math.max(80, canvas.clientHeight || 110);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) { canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  g.fillStyle = COLORS.bg; g.fillRect(0, 0, cssW, cssH);
  const padL = 34, padR = 6, padT = 6, padB = 16;
  const W = cssW - padL - padR, H = cssH - padT - padB;
  const t1 = Math.max(cfg.nowSec, WINDOW_SEC); const t0 = t1 - WINDOW_SEC;
  let lo = cfg.min, hi = cfg.max;
  if (cfg.autoMax) { const m = Math.max(hi, ...cfg.series.flatMap((s) => s.data.filter(Number.isFinite))); hi = Math.ceil(m * 1.1 * 10) / 10 || hi; }
  const x = (t) => padL + ((t - t0) / WINDOW_SEC) * W;
  const y = (v) => padT + H - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * H;
  g.font = '10px "SFMono-Regular", Consolas, monospace'; g.fillStyle = COLORS.axis; g.strokeStyle = COLORS.grid; g.lineWidth = 1;
  for (let i = 0; i <= 2; i++) { const v = lo + (i * (hi - lo)) / 2; const yy = Math.round(y(v)) + 0.5; g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + W, yy); g.stroke(); g.fillText(fmt(v), 2, yy + 3); }
  for (let m = 0; m <= 15; m += 5) { const xx = Math.round(x(t0 + m * 60)) + 0.5; g.beginPath(); g.moveTo(xx, padT); g.lineTo(xx, padT + H); g.stroke(); }
  g.fillText(`−15 min`, padL, cssH - 3); g.fillText('now', padL + W - 20, cssH - 3);
  for (const th of cfg.thresholds || []) {
    g.save(); g.setLineDash([4, 3]); g.strokeStyle = COLORS.thresh; const yy = Math.round(y(th.v)) + 0.5;
    g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + W, yy); g.stroke(); g.restore();
    g.fillStyle = COLORS.thresh; g.fillText(th.label, padL + 3, yy - 2); g.fillStyle = COLORS.axis;
  }
  for (const s of cfg.series) {
    g.save(); g.strokeStyle = s.color; g.lineWidth = 2; if (s.dash) g.setLineDash(s.dash);
    g.beginPath(); let pen = false;
    for (let i = 0; i < cfg.t.length; i++) {
      const tt = cfg.t[i]; if (tt < t0) continue; const v = s.data[i];
      if (!Number.isFinite(v)) { pen = false; continue; }
      if (!pen) { g.moveTo(x(tt), y(v)); pen = true; } else g.lineTo(x(tt), y(v));
    }
    g.stroke(); g.restore();
  }
}

function fmt(v) { return Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); }
