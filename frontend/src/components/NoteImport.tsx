import { useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/ctx'
import { applyFindings, EXAMPLE_NOTE, parseNote } from '../lib/noteParser'
import { valueText } from '../lib/format'

/** Second input modality: free-text clinical notes. Paste or open a referral letter / lab report, see
 *  exactly which words became which input, then load it as the patient. Runs entirely in the browser. */
export function NoteImport({ onClose }: { onClose: () => void }) {
  const { data, load } = useApp()
  const [text, setText] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const feats = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, f])), [data.features])
  const ranges = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, [f.minimum, f.maximum] as [number | null | undefined, number | null | undefined]])), [data.features])
  const found = useMemo(() => (text.trim() ? parseNote(text, ranges) : []), [text, ranges])
  const base = data.presets.find((p) => p.id === 'median')?.inputs ?? data.presets[0].inputs

  const show = (key: string, v: number | string) => {
    const f = feats[key]
    if (!f) return String(v)
    if (f.options) return String(f.options.find((o) => String(o[0]) === String(v))?.[1] ?? v)
    if (f.kind === 'binary') return v === 1 ? 'Yes' : 'No'
    return valueText(f, Number(v))
  }

  return (
    <div className="sheet center" role="dialog" aria-label="Import from a clinical note">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="note-card">
        <div className="note-head">
          <div>
            <h2>Import from a clinical note</h2>
            <p>Paste a referral letter, discharge summary or lab report. It is read in this browser by transparent rules (nothing is uploaded). Inputs the note does not mention keep the dataset's median value.</p>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="note-grid">
          <div className="note-left">
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              placeholder="e.g. 58-year-old man with exertional chest tightness relieved by rest. T2DM, hypertension. BP 152/88. ECG: ST depression V4–V6. LVEF 50%. LDL 3.1 mmol/L…" />
            <div className="note-actions">
              <button className="btn" onClick={() => setText(EXAMPLE_NOTE)}>Try an example letter</button>
              <button className="btn" onClick={() => file.current?.click()}>Open a .txt file</button>
              <input ref={file} type="file" accept=".txt,.md,text/plain" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''
              }} />
              {text && <button className="btn ghost" onClick={() => setText('')}>Clear</button>}
            </div>
          </div>
          <div className="note-right" aria-live="polite">
            <div className="note-count"><b>{found.length}</b> of {data.features.length} inputs found</div>
            {found.length === 0 ? (
              <p className="hint">Values appear here as you type: age and sex, history, symptoms, blood pressure and pulse, ECG findings, echo (EF, wall motion, valves) and blood tests. mmol/L and µmol/L are converted automatically.</p>
            ) : (
              <ul className="note-found">
                {found.map((f) => (
                  <li key={f.key} title={`From: “…${f.text}…”`}>
                    <span className="nf-l">{feats[f.key]?.label ?? f.key}</span>
                    <b className={f.note === 'negated' ? 'neg' : ''}>{show(f.key, f.value)}</b>
                    <small>“{f.text}”</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="note-foot">
          <span className="hint">Always check the extracted values: rule-based reading can miss unusual phrasing.</span>
          <button className="btn primary" disabled={!found.length} onClick={() => { load(applyFindings(base, found), 'note'); onClose() }}>
            Use these {found.length} values
          </button>
        </div>
      </div>
    </div>
  )
}
