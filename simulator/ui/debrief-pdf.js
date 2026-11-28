import { downloadText } from './case-files.js';

const clean = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[–—−]/g, '-').replace(/→/g, ' -> ').replace(/≥/g, '>=').replace(/≤/g, '<=')
  .replace(/×/g, 'x').replace(/µ|μ/g, 'u').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[·•]/g, '-').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
const literal = (value) => clean(value).replace(/[\\()]/g, '\\$&');

function wrap(text, width) {
  const measure = (value) => [...value].reduce((sum, char) => sum +
    (' ilI.,:;!|'.includes(char) ? 0.36 : 'MWmw@%&'.includes(char) ? 1.05 : /[A-Z]/.test(char) ? 0.85 : 0.67), 0);
  const words = clean(text).split(' ').flatMap((word) => measure(word) > width ? word.match(new RegExp(`.{1,${Math.floor(width / 1.05)}}`, 'g')) : [word]);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && measure(`${line} ${word}`) > width) { lines.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}

export function buildDebriefPdf(module, blocks) {
  const pages = [];
  const heading = 'Smart NOA | Simulation debrief';
  let commands, y;
  function label(value, x, top, size, bold = false) {
    commands.push(`BT /${bold ? 'B' : 'R'} ${size} Tf 0.10 0.17 0.25 rg 1 0 0 1 ${x} ${top} Tm (${literal(value)}) Tj ET`);
  }
  function page() {
    commands = [];
    pages.push(commands);
    commands.push('0.12 0.36 0.47 rg 44 752 524 4 re f');
    label(heading, 44, 726, pages.length === 1 ? 22 : 15, true);
    label(module, 44, 704, 11);
    label('Fictional patient | Educational use only', 44, 687, 9);
    y = 659;
  }
  function space(height) { if (y - height < 65) page(); }
  function body(value, isHeading = false) {
    const lines = wrap(value, 520 / (isHeading ? 13 : 10));
    if (!lines.length) return;
    if (isHeading) { space(36); y -= 7; }
    else if (lines.length <= 5) space(lines.length * 15);
    for (const line of lines) {
      space(15);
      label(line, 44, y, isHeading ? 13 : 10, isHeading);
      y -= 15;
    }
    y -= 5;
  }
  page();
  for (const [left, right] of [['Learner', 'Course / group'], ['Reviewer', 'Date']]) {
    label(left, 44, y, 10, true);
    label(right, 310, y, 10, true);
    commands.push(`0.67 0.72 0.76 RG 105 ${y - 2} m 285 ${y - 2} l S 394 ${y - 2} m 568 ${y - 2} l S`);
    y -= 23;
  }
  for (const block of blocks) body(block.text, block.heading);
  space(124);
  body('Reviewer feedback', true);
  for (const prompt of ['What went well', 'What could improve', 'Next step / grade']) {
    label(prompt, 44, y, 10, true);
    commands.push(`0.67 0.72 0.76 RG 170 ${y - 3} m 568 ${y - 3} l S`);
    y -= 24;
  }
  pages.forEach((p, i) => p.push(`BT /R 9 Tf 0.23 0.30 0.36 rg 1 0 0 1 44 39 Tm (Smart NOA | ${i + 1} / ${pages.length}) Tj ET`));
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const children = [];
  for (const p of pages) {
    const pageId = objects.length + 1;
    children.push(`${pageId} 0 R`);
    const stream = p.join('\n') + '\n';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /R 3 0 R /B 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${children.join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const clock = (t) => Number.isFinite(t)
  ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : 'Time not recorded';

export function workflowBlocks({ plan, planStatus = [], summary, log = [], mar = [], automaticMode } = {}) {
  const blocks = [];
  const section = (text) => blocks.push({ text, heading: true });
  const line = (text) => blocks.push({ text });
  if (plan?.steps?.length) {
    section('Anesthesia plan and execution');
    const results = new Map(planStatus.map((step) => [step.id, step]));
    for (const step of plan.steps) {
      const execution = results.get(step.id);
      const result = execution?.result;
      const amount = step.amount != null ? `${step.amount} ${step.amountUnit ?? ''}`
        : step.rate != null ? `${step.rate} ${step.rateUnit ?? ''}` : '';
      line(`${step.phase} +${clock(step.atSec)} | ${step.drugId} | ${step.kind} ${amount}${step.route ? ` ${step.route}` : ''}${step.overSec ? ` over ${clock(step.overSec)}` : ''} | ${execution?.status ?? 'No execution status recorded'}${Number.isFinite(result?.tSec) ? ` at ${clock(result.tSec)}` : ''}`);
      const rationale = step.timingRationale;
      if (step.regimenKey || rationale?.text) line(`Planned use: ${step.regimenKey ?? 'not recorded'}${rationale?.text ? `. ${rationale.text}` : ''}${rationale?.sources?.length ? ` [${rationale.sources.join(', ')}]` : ''}`);
      else line('Plan rationale not recorded.');
      for (const reason of [...(result?.reasons ?? []), ...(result?.warnings ?? [])]) line(reason);
    }
  }
  if (summary?.alarms?.length) {
    section('Alarm history');
    for (const alarm of summary.alarms) {
      const started = Number.isFinite(alarm.sinceSec) ? clock(alarm.sinceSec) : Number.isFinite(alarm.tMin) ? `Minute ${alarm.tMin}` : 'Time not recorded';
      line(`${started} | ${alarm.priority ?? ''} | ${alarm.message ?? alarm.id}${Number.isFinite(alarm.clearedSec) ? ` | Cleared ${clock(alarm.clearedSec)}` : ''}`);
    }
  }
  if (automaticMode?.pauses?.length) {
    section('Pauses and reasons');
    for (const pause of automaticMode.pauses) {
      line(`${clock(pause.tSec)} | Paused by ${pause.by ?? 'simulation'}${Number.isFinite(pause.resumedAtSec) ? ` | Resumed ${clock(pause.resumedAtSec)}` : ''}`);
      for (const reason of pause.reasons ?? []) line(reason);
    }
  }
  if (mar.length) {
    section('Medication administration record');
    for (const entry of mar) {
      line(`Minute ${entry.tMin} | ${entry.drugId} | ${entry.dose} ${entry.unit ?? ''} ${entry.route ?? ''} | ${entry.kind ?? ''} | ${entry.by ?? 'Initiator not recorded'}`);
    }
  }
  if (log.length) {
    section('Complete recorded event log');
    line('The log includes actions, warnings, and refusals. A reason is shown when recorded by the simulator.');
    for (const event of log) {
      const t = Number.isFinite(event.tSec) ? clock(event.tSec) : Number.isFinite(event.tMin) ? `Minute ${event.tMin}` : 'Time not recorded';
      line(`${t} | ${event.kind ?? 'event'} | ${event.message ?? ''}`);
    }
  }
  return blocks;
}

export function downloadDebriefPdf(module, patient, root = document.getElementById('main'), workflow) {
  const sections = [];
  if (patient) {
    sections.push({ heading: true, text: 'Fictional patient profile' });
    sections.push({ text: `Age ${patient.ageYears} years | Sex ${patient.sex} | Weight ${patient.weightKg} kg | eGFR ${patient.egfr} mL/min/1.73 m2` });
    if (patient.asa) sections.push({ text: `ASA ${patient.asa} | Height ${patient.heightCm} cm | Conditions: ${patient.conditions?.join(', ') || 'none recorded'}` });
    else if (patient.setting) sections.push({ text: `Setting: ${patient.setting} | Diagnosis: ${patient.diagnosis} | Goals: ${patient.goals}` });
  }
  for (const node of root.querySelectorAll('h2,h3,h4,summary,p,li,dt,dd,tr,pre')) {
    if (node.parentElement.closest('p,li,dt,dd,tr,pre,summary') || node.closest('[hidden]')) continue;
    const text = node.matches('tr') ? [...node.cells].map((cell) => cell.textContent.trim()).join(' | ') : node.textContent;
    if (text.trim()) sections.push({ text, heading: node.matches('h2,h3,h4,summary') });
  }
  sections.push(...workflowBlocks(workflow));
  const title = { periop: 'Perioperative anesthesia', pain: 'Palliative pain management', eol: 'End-of-life care' }[module];
  downloadText(`smart-noa-${module}-debrief.pdf`, buildDebriefPdf(title, sections), 'application/pdf');
}
