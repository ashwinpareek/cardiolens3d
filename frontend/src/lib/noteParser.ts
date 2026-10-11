/** Clinical-note import: turns a free-text referral letter, discharge summary or lab printout into model
 *  inputs. Fully rule-based and offline (no text leaves the browser), so every extracted value can be
 *  traced back to the words it came from. Anything the note does not mention keeps its default value.
 *
 *  Handles: "62-year-old man", "62M", "BP 150/90", "HbA1c"-free diabetes mentions, negations
 *  ("no diabetes", "denies smoking", "non-smoker"), NYHA class, EF %, ECG findings, and SI lab units
 *  (glucose and lipids in mmol/L, creatinine in µmol/L) converted to the units the model was trained on.
 */
import type { Inputs } from './types'

export interface Finding { key: string; value: number | string; text: string; note?: string }

const NEG = /\b(no|not|denies|denied|without|negative for|absent|never|free of|ruled out|r\/o)\b[^.;\n]{0,30}$/i

/** True if the match at `index` is preceded (same clause, within ~30 chars) by a negation. */
function negated(src: string, index: number) {
  const before = src.slice(Math.max(0, index - 40), index)
  const clause = before.split(/[.;\n]/).pop() ?? ''
  return NEG.test(clause)
}

const num = (s: string) => Number(s.replace(',', '.'))

interface Rule { key: string; re: RegExp; value?: number | string; read?: (m: RegExpExecArray) => number | string | null; neg?: boolean }

// presence rules: the term sets the feature to 1, a negation in the same clause sets it to 0
const flag = (key: string, re: RegExp): Rule => ({ key, re, value: 1, neg: true })

const RULES: Rule[] = [
  // ---- demographics
  { key: 'age', re: /\b(\d{2})\s*(?:-|\s)?\s*(?:years?|yrs?|y\.?o\.?|year-old|yo)\b/i, read: (m) => num(m[1]) },
  { key: 'age', re: /\bage[d:]?\s*(\d{2})\b/i, read: (m) => num(m[1]) },
  { key: 'age', re: /\b(\d{2})\s?([MF])\b/, read: (m) => num(m[1]) },
  { key: 'sex_male', re: /\b\d{2}\s?([MF])\b/, read: (m) => (m[1] === 'M' ? 1 : 0) },
  { key: 'sex_male', re: /\b(male|man|gentleman|mr|female|woman|lady|mrs|ms)\b/i, read: (m) => (/^(male|man|gentleman|mr)$/i.test(m[1]) ? 1 : 0) },
  { key: 'sex_male', re: /\b(he|his|him|she|her)\b/i, read: (m) => (/^(he|his|him)$/i.test(m[1]) ? 1 : 0) },
  { key: 'weight', re: /\b(?:weight|wt)[:\s]*(\d{2,3}(?:[.,]\d)?)\s*kg\b/i, read: (m) => num(m[1]) },
  { key: 'weight', re: /\b(\d{2,3}(?:[.,]\d)?)\s*kg\b/i, read: (m) => num(m[1]) },
  { key: 'height', re: /\b(?:height|ht)[:\s]*(\d{3})\s*cm\b/i, read: (m) => num(m[1]) },
  { key: 'height', re: /\b(1[3-9]\d)\s*cm\b/i, read: (m) => num(m[1]) },
  { key: 'bmi', re: /\bBMI[:\s]*(\d{2}(?:[.,]\d)?)/i, read: (m) => num(m[1]) },

  // ---- history
  flag('dm', /\b(diabet(?:es|ic)|T2DM|T1DM|DM\b|NIDDM|IDDM)/i),
  flag('htn', /\b(hypertension|hypertensive|HTN\b|high blood pressure)/i),
  flag('dlp', /\b(dyslipid(?:a)?emia|hyperlipid(?:a)?emia|hypercholesterol(?:a)?emia|high cholesterol|on (?:a )?statins?)/i),
  flag('fh', /\b(family history|FHx|FH of|father|mother|brother|sister)\b[^.;\n]{0,60}\b(heart|cardiac|CAD|MI|infarct|coronary)/i),
  flag('crf', /\b(CKD|chronic kidney|chronic renal|renal failure|ESRD|dialysis)/i),
  flag('cva', /\b(stroke|CVA\b|cerebrovascular accident|TIA\b)/i),
  flag('chf', /\b(heart failure|CHF\b|HFrEF|HFpEF)/i),
  flag('airway', /\b(asthma|COPD|chronic obstructive|bronchitis)/i),
  flag('thyroid', /\b(hypothyroid|hyperthyroid|thyroid disease|levothyroxine)/i),
  { key: 'ex_smoker', re: /\b(ex-?smoker|former smoker|quit smoking|stopped smoking|ex smoker)/i, value: 1, neg: false },
  { key: 'current_smoker', re: /\b(current(?:ly)? smok\w*|active smoker|smokes|\d+\s*(?:cig|pack)[\w\s-]*(?:day|year))/i, value: 1, neg: true },
  { key: 'current_smoker', re: /\b(non-?smoker|never smoked|never-smoker|does not smoke|doesn't smoke)/i, value: 0 },

  // ---- symptoms & examination
  { key: 'bp', re: /\b(?:BP|blood pressure|B\.P\.)[:\s]*(?:of\s*)?(\d{2,3})\s*\/\s*\d{2,3}/i, read: (m) => num(m[1]) },
  { key: 'bp', re: /\b(?:SBP|systolic)[:\s]*(\d{2,3})/i, read: (m) => num(m[1]) },
  { key: 'pr', re: /\b(?:pulse|PR|HR|heart rate)[:\s]*(?:of\s*)?(\d{2,3})\s*(?:bpm|\/min|beats)?/i, read: (m) => num(m[1]) },
  { key: 'typical_cp', re: /\bchest (?:pain|tightness|pressure|discomfort|heaviness)[^.;\n]{0,60}(?:exertion|exercise|walking|uphill|stairs|effort|exert)[^.;\n]{0,60}(?:reliev|eas|settl|resolv)\w*[^.;\n]{0,25}(?:rest|GTN|nitro)/i, value: 1, neg: true },
  { key: 'typical_cp', re: /\b(typical (?:angina|chest pain)|exertional (?:chest )?(?:pain|pressure|tightness)[^.;\n]{0,40}(?:rest|nitro|GTN))/i, value: 1, neg: true },
  { key: 'atypical', re: /\batypical (?:angina|chest pain)/i, value: 1, neg: true },
  { key: 'nonanginal', re: /\b(non-?anginal|non-?cardiac chest pain|musculoskeletal chest pain)/i, value: 1, neg: true },
  { key: 'lowth_ang', re: /\b(low[- ]threshold angina|angina at (?:rest|minimal exertion))/i, value: 1, neg: true },
  flag('dyspnea', /\b(dyspn(?:o)?ea|shortness of breath|breathless(?:ness)?|SOB\b|DOE\b)/i),
  flag('edema', /\b(o?edema|ankle swelling|swollen ankles|pedal swelling)/i),
  flag('weak_pulse', /\b(weak|diminished|absent) (?:peripheral |pedal |distal )?pulses?/i),
  flag('lung_rales', /\b(rales|crackles|crepitations)/i),
  flag('sys_murmur', /\b(systolic murmur|ejection murmur)/i),
  flag('dia_murmur', /\bdiastolic murmur/i),
  { key: 'function_class', re: /\b(?:NYHA|functional class|FC)\s*(?:class\s*)?(IV|III|II|I|[1-4])\b/i,
    read: (m) => Math.min(3, ({ I: 1, II: 2, III: 3, IV: 3 } as Record<string, number>)[m[1].toUpperCase()] ?? Number(m[1])) },

  // ---- ECG
  flag('q_wave', /\b(pathological Q|Q[- ]waves?)/i),
  flag('st_elevation', /\b(ST[- ]elevation|STE\b|ST segment elevation)/i),
  flag('st_depression', /\b(ST[- ]depression|ST segment depression)/i),
  flag('t_inversion', /\b(T[- ]wave inversions?|inverted T[- ]waves?|TWI\b)/i),
  flag('lvh', /\b(LVH\b|left ventricular hypertrophy)/i),
  flag('poor_r', /\bpoor R[- ]wave progression/i),
  { key: 'bbb', re: /\b(LBBB|left bundle branch block)/i, value: 'LBBB' },
  { key: 'bbb', re: /\b(RBBB|right bundle branch block)/i, value: 'RBBB' },

  // ---- echo
  { key: 'ef', re: /\b(?:EF|LVEF|ejection fraction)[:\s]*(?:of\s*|is\s*|was\s*)?(?:~|about\s*)?(\d{2})\s*%?/i, read: (m) => num(m[1]) },
  { key: 'rwma', re: /\b(?:RWMA|regional wall[- ]motion abnormalit\w*)[:\s]*(?:in\s*)?(\d)\b/i, read: (m) => Math.min(4, num(m[1])) },
  { key: 'rwma', re: /\b(\d)\s*(?:segments?|regions?|walls?)\b[^.;\n]{0,30}(?:hypokine|akine|dyskine|wall[- ]motion)/i, read: (m) => Math.min(4, num(m[1])) },
  { key: 'rwma', re: /\b(?:hypokine|akine|dyskine)\w*\s+(?:of|in)\s+(\d)\s+(?:segments?|walls?|regions?)/i, read: (m) => Math.min(4, num(m[1])) },
  { key: 'rwma', re: /\b(normal (?:regional )?wall motion|no (?:regional )?wall[- ]motion abnormalit\w*|no RWMA)/i, value: 0 },
  { key: 'vhd', re: /\b(mild|moderate|severe)\b[^.;\n]{0,20}\b(?:mitral|aortic|tricuspid|valv\w*)\s*(?:regurgitation|stenosis|insufficiency|disease)?/i,
    read: (m) => ({ mild: 1, moderate: 2, severe: 3 } as Record<string, number>)[m[1].toLowerCase()] },

  // ---- labs (US units, or SI converted)
  { key: 'fbs', re: /\b(?:FBS|FBG|fasting (?:blood )?(?:sugar|glucose))[:\s]*(\d{1,3}(?:[.,]\d+)?)\s*(mmol\/l|mg\/dl)?/i,
    read: (m) => (/mmol/i.test(m[2] ?? '') || num(m[1]) < 30 ? Math.round(num(m[1]) * 18) : num(m[1])) },
  { key: 'ldl', re: /\bLDL(?:-C)?[:\s]*(\d{1,3}(?:[.,]\d+)?)\s*(mmol\/l|mg\/dl)?/i,
    read: (m) => (/mmol/i.test(m[2] ?? '') || num(m[1]) < 15 ? Math.round(num(m[1]) * 38.67) : num(m[1])) },
  { key: 'hdl', re: /\bHDL(?:-C)?[:\s]*(\d{1,3}(?:[.,]\d+)?)\s*(mmol\/l|mg\/dl)?/i,
    read: (m) => (/mmol/i.test(m[2] ?? '') || num(m[1]) < 5 ? Math.round(num(m[1]) * 38.67) : num(m[1])) },
  { key: 'tg', re: /\b(?:TG|triglycerides?)[:\s]*(\d{1,4}(?:[.,]\d+)?)\s*(mmol\/l|mg\/dl)?/i,
    read: (m) => (/mmol/i.test(m[2] ?? '') || num(m[1]) < 15 ? Math.round(num(m[1]) * 88.57) : num(m[1])) },
  { key: 'cr', re: /\b(?:Cr|creat(?:inine)?)[:\s]*(\d{1,3}(?:[.,]\d+)?)\s*(µmol\/l|umol\/l|mg\/dl)?/i,
    read: (m) => (/mol/i.test(m[2] ?? '') || num(m[1]) > 15 ? Math.round((num(m[1]) / 88.4) * 10) / 10 : num(m[1])) },
  { key: 'bun', re: /\b(?:BUN|urea nitrogen)[:\s]*(\d{1,3})/i, read: (m) => num(m[1]) },
  { key: 'hb', re: /\b(?:Hb|Hgb|ha?emoglobin)[:\s]*(\d{1,2}(?:[.,]\d)?)\s*(g\/dl|g\/l)?/i,
    read: (m) => (/g\/l/i.test(m[2] ?? '') || num(m[1]) > 25 ? Math.round(num(m[1])) / 10 : num(m[1])) },
  { key: 'k', re: /\b(?:K\+?|potassium)[:\s]*(\d(?:[.,]\d)?)\b/, read: (m) => num(m[1]) },
  { key: 'na', re: /\b(?:Na\+?|sodium)[:\s]*(1\d{2})\b/i, read: (m) => num(m[1]) },
  { key: 'wbc', re: /\b(?:WBC|white (?:cell|blood cell) count)[:\s]*(\d{1,2}(?:[.,]\d)?|\d{4,5})/i,
    read: (m) => (num(m[1]) < 100 ? Math.round(num(m[1]) * 1000) : num(m[1])) },
  { key: 'esr', re: /\bESR[:\s]*(\d{1,3})/i, read: (m) => num(m[1]) },
  { key: 'plt', re: /\b(?:PLT|platelets?)[:\s]*(\d{2,3})/i, read: (m) => num(m[1]) },
  { key: 'lymph', re: /\blymph(?:ocytes?)?[:\s]*(\d{1,2})\s*%/i, read: (m) => num(m[1]) },
  { key: 'neut', re: /\bneut(?:rophils?)?[:\s]*(\d{1,2})\s*%/i, read: (m) => num(m[1]) },
]

const clip = (s: string, i: number, len: number) => s.slice(Math.max(0, i - 12), Math.min(s.length, i + len + 12)).replace(/\s+/g, ' ').trim()

/** Parse a note. Rules are ordered from most to least specific; the first rule that matches a feature wins. */
export function parseNote(text: string, ranges: Record<string, [number | null | undefined, number | null | undefined]> = {}): Finding[] {
  const found = new Map<string, Finding>()
  for (const r of RULES) {
    if (found.has(r.key)) continue
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      let v: number | string | null = r.read ? r.read(m) : (r.value ?? 1)
      if (v == null || (typeof v === 'number' && !Number.isFinite(v))) continue
      let note: string | undefined
      if (r.neg && negated(text, m.index)) { v = typeof v === 'number' ? 0 : 'N'; note = 'negated' }
      const [lo, hi] = ranges[r.key] ?? []
      if (typeof v === 'number' && ((lo != null && v < lo) || (hi != null && v > hi))) continue // implausible: skip, keep looking
      found.set(r.key, { key: r.key, value: v, text: clip(text, m.index, m[0].length), note })
      break
    }
  }
  // smoking: current and former are exclusive in the dataset; "ex-smoker" wins over a bare "smoker"
  const ex = found.get('ex_smoker')
  if (ex?.value === 1) found.set('current_smoker', { key: 'current_smoker', value: 0, text: ex.text })
  else if (found.get('current_smoker')?.value === 1) found.set('ex_smoker', { key: 'ex_smoker', value: 0, text: found.get('current_smoker')!.text })
  return [...found.values()]
}

/** Apply findings on top of a base patient, keeping BMI / obesity consistent with weight and height. */
export function applyFindings(base: Inputs, f: Finding[]): Inputs {
  const out: Inputs = { ...base }
  for (const x of f) out[x.key] = x.value
  const has = (k: string) => f.some((x) => x.key === k)
  if (!has('bmi') && (has('weight') || has('height'))) out.bmi = Math.round((Number(out.weight) / (Number(out.height) / 100) ** 2) * 10) / 10
  out.obesity = Number(out.bmi) > 25 ? 1 : 0
  return out
}

export const EXAMPLE_NOTE = `Referral letter, cardiology outpatients

58-year-old man referred with a 3-month history of central chest tightness on walking uphill, relieved by rest within a few minutes. Exertional breathlessness (NYHA class II). No ankle swelling.

PMH: type 2 diabetes (T2DM) on metformin, hypertension. Ex-smoker, quit 5 years ago. Father had an MI at 52. No previous stroke.

Exam: BP 152/88, pulse 84 bpm. Weight 86 kg, height 172 cm. Heart sounds normal, no murmur. Chest clear.

ECG: sinus rhythm, ST depression in V4-V6, no Q waves.
Echo: LVEF 50%, hypokinesia of 2 segments (inferior wall), mild mitral regurgitation.

Bloods: fasting glucose 7.4 mmol/L, LDL 3.1 mmol/L, HDL 0.9 mmol/L, triglycerides 2.1 mmol/L, creatinine 96 umol/L, Hb 13.9 g/dL, K 4.3, Na 139, WBC 7.2, ESR 18, platelets 245.`
