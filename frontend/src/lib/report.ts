/* Client-side report generation: a 2-page A4 PDF (jsPDF, bundled, works offline) plus JSON and CSV
 * exports of the inputs, predictions and per-feature contributions. */
import { jsPDF } from 'jspdf'
import type { DatasetPatient, FeatureSpec, Inputs, ModelCard, Prediction, TargetId } from './types'
import { TARGETS } from './types'
import { narrative, rank, valueText } from './format'
import { groupContributions, GROUP_META } from './explain'
import { riskHex } from './risk'

const TNAME: Record<TargetId, string> = { CAD: 'Coronary artery disease', LAD: 'LAD stenosis', LCX: 'LCX stenosis', RCA: 'RCA stenosis' }
const p0 = (p: number) => (p > 0.995 ? '>99%' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`)
const ascii = (s: string) => s.replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/≥/g, '>=').replace(/×/g, 'x').replace(/÷/g, '/').replace(/·/g, '-').replace(/[²]/g, '2').replace(/[³]/g, '3').replace(/µ/g, 'u').replace(/[^\x20-\x7E]/g, '')
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

export interface ReportInput {
  pred: Prediction
  inputs: Inputs
  features: FeatureSpec[]
  card: ModelCard
  source: string
  snapshot: string | null   // PNG data URL of the 3D view
  similar: DatasetPatient[]
}

export function statusWord(t: Prediction['targets'][TargetId], cad = false) {
  if (t.set.length !== 1) return 'Uncertain'
  const pos = t.set[0] === 1 || t.p >= t.threshold
  return cad ? (pos ? 'Likely present' : 'Likely absent') : (pos ? 'Likely narrowed' : 'Likely clear')
}

export function buildPdf(r: ReportInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const feats = Object.fromEntries(r.features.map((f) => [f.key, f]))
  const W = 210, M = 14
  let y = 0

  // ---- header band
  doc.setFillColor(12, 24, 35); doc.rect(0, 0, W, 26, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
  doc.text('CardioLens 3D - coronary risk report', M, 12)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(184, 199, 210)
  doc.text(ascii(`${r.source} - generated ${new Date().toLocaleString()} - model trained ${r.card.created.slice(0, 10)} on ${r.card.dataset.n} patients`), M, 19)
  y = 32
  // ---- disclaimer
  doc.setFillColor(255, 244, 220); doc.setDrawColor(230, 199, 102); doc.rect(M, y, W - 2 * M, 11, 'FD')
  doc.setTextColor(107, 74, 0); doc.setFontSize(8.5)
  doc.text('For decision support and education only. Not a diagnosis and not a substitute for coronary angiography,', M + 3, y + 4.5)
  doc.text("CT coronary angiography or a clinician's judgement.", M + 3, y + 8.5)
  y += 17

  // ---- snapshot + summary table
  const imgW = 86, imgH = 62
  if (r.snapshot) {
    doc.setFillColor(12, 24, 35); doc.rect(M, y, imgW, imgH, 'F')
    try {
      const props = doc.getImageProperties(r.snapshot)
      const sc = Math.min(imgW / props.width, imgH / props.height)
      const w = props.width * sc, h = props.height * sc
      doc.addImage(r.snapshot, 'PNG', M + (imgW - w) / 2, y + (imgH - h) / 2, w, h, undefined, 'FAST')
    } catch { /* ignore */ }
  }
  const tx = M + imgW + 8
  doc.setTextColor(21, 34, 44); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('Estimates', tx, y + 4)
  doc.setFontSize(8); doc.setTextColor(106, 120, 130); doc.setFont('helvetica', 'normal')
  doc.text('Probability', tx + 40, y + 10); doc.text('90% range', tx + 58, y + 10); doc.text('Verdict', tx + 78, y + 10)
  TARGETS.forEach((t, i) => {
    const p = r.pred.targets[t]
    const yy = y + 17 + i * 11
    doc.setFillColor(...hex(riskHex(p.p))); doc.circle(tx + 2, yy - 1.3, 1.8, 'F')
    doc.setTextColor(21, 34, 44); doc.setFontSize(9.5); doc.setFont('helvetica', 'bold')
    doc.text(t === 'CAD' ? 'CAD (overall)' : `${t} artery`, tx + 6, yy)
    doc.setFont('helvetica', 'normal'); doc.text(p0(p.p), tx + 40, yy)
    doc.setFontSize(8.5); doc.text(`${p0(p.lo)}-${p0(p.hi)}`, tx + 58, yy); doc.text(statusWord(p, t === 'CAD'), tx + 78, yy)
    // bar
    doc.setFillColor(231, 236, 236); doc.rect(tx + 6, yy + 2, 90, 2.2, 'F')
    doc.setFillColor(...hex(riskHex(p.p))); doc.rect(tx + 6, yy + 2, 90 * p.p, 2.2, 'F')
  })
  y += imgH + 8

  // ---- explanations
  const section = (title: string) => {
    if (y > 262) { doc.addPage(); y = 18 }
    doc.setDrawColor(21, 34, 44); doc.setLineWidth(0.4); doc.line(M, y, W - M, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(21, 34, 44); doc.text(title, M, y + 6)
    y += 11
  }
  const para = (text: string, size = 9, color: [number, number, number] = [21, 34, 44]) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
    const lines = doc.splitTextToSize(ascii(text), W - 2 * M) as string[]
    for (const l of lines) { if (y > 284) { doc.addPage(); y = 18 } doc.text(l, M, y); y += size * 0.45 }
    y += 1.5
  }

  section('Why: the main factors behind each estimate')
  for (const t of TARGETS) {
    const att = r.pred.attributions[t]
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(21, 34, 44); doc.text(TNAME[t], M, y); y += 4.3
    para(narrative(t, r.pred.targets[t].p, att, feats, r.inputs))
    const top = rank(att, feats).slice(0, 6)
    const max = Math.max(...top.map((x) => Math.abs(x.c)), 0.2)
    for (const x of top) {
      if (y > 284) { doc.addPage(); y = 18 }
      doc.setFontSize(8.2); doc.setTextColor(60, 75, 85)
      doc.text(ascii(`${x.f.label} (${valueText(x.f, r.inputs[x.key])})`), M + 2, y)
      const cx = M + 112, w = (Math.abs(x.c) / max) * 30
      doc.setDrawColor(216, 223, 225); doc.line(cx, y - 2.6, cx, y + 0.6)
      doc.setFillColor(...(x.c > 0 ? [212, 61, 61] as [number, number, number] : [47, 181, 163] as [number, number, number]))
      doc.rect(x.c > 0 ? cx : cx - w, y - 2.4, w, 2.6, 'F')
      doc.text(`${x.c > 0 ? '+' : ''}${x.c.toFixed(2)}  (odds x${Math.exp(x.c).toFixed(2)})`, M + 148, y)
      y += 4.1
    }
    y += 2
  }

  section('Which parts of the check-up drive the CAD estimate')
  const groups = groupContributions(r.pred.attributions.CAD, r.features)
  const gmax = Math.max(...groups.map((g) => Math.abs(g.net)), 0.3)
  for (const g of groups) {
    doc.setFontSize(8.6); doc.setTextColor(21, 34, 44)
    doc.text(ascii(GROUP_META[g.group].label), M + 2, y)
    const cx = M + 80, w = (Math.abs(g.net) / gmax) * 40
    doc.setDrawColor(216, 223, 225); doc.line(cx, y - 2.8, cx, y + 0.8)
    doc.setFillColor(...(g.net > 0 ? [212, 61, 61] as [number, number, number] : [47, 181, 163] as [number, number, number]))
    doc.rect(g.net > 0 ? cx : cx - w, y - 2.5, w, 2.8, 'F')
    doc.setTextColor(106, 120, 130); doc.text(`${Math.round(g.share * 100)}% of the explanation`, M + 130, y)
    y += 4.6
  }

  section('Measurements against usual adult ranges')
  const meas = r.features.filter((f) => f.kind === 'numeric' && f.normal)
  meas.forEach((f, i) => {
    const col = i % 2, xx = M + col * 92
    if (col === 0 && i > 0) y += 4.3
    if (y > 284) { doc.addPage(); y = 18 }
    const v = Number(r.inputs[f.key]); const [lo, hi] = f.normal!
    const flag = v > hi ? 'HIGH' : v < lo ? 'LOW' : 'ok'
    doc.setFontSize(8.2); doc.setTextColor(60, 75, 85); doc.text(ascii(f.label), xx, y)
    doc.setTextColor(21, 34, 44); doc.text(ascii(valueText(f, v)), xx + 48, y)
    doc.setTextColor(...(flag === 'ok' ? [140, 150, 158] as [number, number, number] : flag === 'HIGH' ? [161, 43, 37] as [number, number, number] : [42, 127, 184] as [number, number, number]))
    doc.text(`${flag}  (${lo}-${hi})`, xx + 70, y)
  })
  y += 8

  section('Similar patients in the dataset')
  const n = (t: TargetId) => r.similar.filter((p) => p.labels[t]).length
  para(`Of the ${r.similar.length} most similar real patients, ${n('CAD')} had coronary artery disease at angiography; LAD narrowed in ${n('LAD')}, LCX in ${n('LCX')}, RCA in ${n('RCA')}.`)

  section('About the model')
  const m = r.card.targets
  para(`Logistic models with exact per-feature attributions, validated with 5x5 repeated nested cross-validation on the UCI Extension of Z-Alizadeh Sani dataset (303 patients). ROC-AUC: CAD ${m.CAD.metrics.auc[0].toFixed(2)}, LAD ${m.LAD.metrics.auc[0].toFixed(2)}, LCX ${m.LCX.metrics.auc[0].toFixed(2)}, RCA ${m.RCA.metrics.auc[0].toFixed(2)}. Vessel probabilities are P(CAD) x P(vessel | CAD). "Uncertain" means the 90% conformal prediction set contains both outcomes.`, 8.4, [60, 75, 85])

  section('All inputs')
  para(r.features.map((f) => `${f.label}: ${valueText(f, r.inputs[f.key])}`).join('; '), 7.6, [60, 75, 85])

  // footer on each page
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140, 150, 158)
    doc.text(`CardioLens 3D - decision support and education only - page ${i} of ${pages}`, M, 292)
  }
  return doc
}

/** Save a generated file. Inside the claude.ai artifact viewer the page cannot download directly, so it
 *  asks the viewer through the `downloads` capability; everywhere else it uses a normal download link. */
export async function downloadBlob(name: string, blob: Blob): Promise<'saved' | 'declined' | 'link'> {
  const claude = (window as any).claude
  if (claude?.use) {
    const dl = await claude.use('downloads').catch(() => null)
    if (dl) {
      try { await dl.save({ filename: name, data: blob }); return 'saved' } catch (e: any) { if (e?.code === 'declined') return 'declined' }
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  return 'link'
}

export function exportJson(r: ReportInput) {
  const out = {
    generated: new Date().toISOString(), source: r.source, disclaimer: 'Decision support and education only. Not a diagnosis.',
    inputs: r.inputs,
    predictions: Object.fromEntries(TARGETS.map((t) => [t, { ...r.pred.targets[t], verdict: statusWord(r.pred.targets[t], t === 'CAD') }])),
    attributions_log_odds: r.pred.attributions,
  }
  return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
}

export function exportCsv(r: ReportInput) {
  const rows = [['feature', 'label', 'value', 'unit', ...TARGETS.map((t) => `contribution_${t}`)]]
  for (const f of r.features) {
    rows.push([f.key, f.label, String(r.inputs[f.key]), f.unit, ...TARGETS.map((t) => (r.pred.attributions[t].contributions[f.key] ?? 0).toFixed(5))])
  }
  rows.push([])
  rows.push(['target', 'probability', 'low_90', 'high_90', 'threshold', 'verdict'])
  for (const t of TARGETS) {
    const p = r.pred.targets[t]
    rows.push([t, p.p.toFixed(5), p.lo.toFixed(5), p.hi.toFixed(5), p.threshold.toFixed(5), statusWord(p, t === 'CAD')])
  }
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return new Blob([rows.map((r) => r.map((c) => esc(String(c ?? ''))).join(',')).join('\n')], { type: 'text/csv' })
}
