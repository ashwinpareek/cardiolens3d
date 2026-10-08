import { useEffect, useRef } from 'react'
import type { Inputs } from '../lib/types'

/** Illustrative single-lead ECG drawn from the patient's ECG inputs and pulse rate.
 *  Morphology follows the flags (Q wave, ST elevation/depression, T inversion, LVH, bundle branch block),
 *  so a change in the form is visible on the monitor. It is a drawing, not a recording. */
function beat(t: number, x: Inputs): number {
  // t in [0,1) of one cardiac cycle; returns millivolt-like amplitude
  const g = (c: number, w: number, a: number) => a * Math.exp(-((t - c) ** 2) / (2 * w * w))
  const wide = x.bbb && x.bbb !== 'N' ? 1.9 : 1
  const r = Number(x.lvh) ? 1.55 : 1.0
  let v = g(0.12, 0.022, 0.13)                                   // P
  v += g(0.215, 0.008 * wide, Number(x.q_wave) ? -0.38 : -0.07)  // Q
  v += g(0.24, 0.011 * wide, r)                                   // R
  if (x.bbb === 'RBBB') v += g(0.275, 0.01, 0.45)                 // R' (rabbit ears)
  if (x.bbb === 'LBBB') v += g(0.262, 0.012, 0.35)                // notched broad R
  v += g(0.265 + 0.01 * (wide - 1), 0.009 * wide, -0.22)          // S
  const st = Number(x.st_elevation) ? 0.22 : Number(x.st_depression) ? -0.18 : 0
  if (t > 0.29 && t < 0.4) v += st * Math.sin(((t - 0.29) / 0.11) * Math.PI * 0.5 + Math.PI * 0.25)
  v += g(0.47, 0.045, Number(x.t_inversion) ? -0.3 : 0.32) + (st && t >= 0.4 && t < 0.47 ? st * (1 - (t - 0.4) / 0.07) : 0) // T
  return v
}

export function EcgStrip({ inputs, bpm, playing = true }: { inputs: Inputs; bpm: number; playing?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const inp = useRef(inputs)
  inp.current = inputs
  const rate = useRef(bpm)
  rate.current = bpm

  useEffect(() => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    let raf = 0
    let phase = 0
    let last = performance.now()
    const hist: number[] = []
    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = c.clientWidth, H = c.clientHeight
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const samples = Math.max(1, Math.round(dt * 220))
      for (let i = 0; i < samples; i++) {
        if (playing) phase = (phase + (rate.current / 60) * (dt / samples)) % 1
        hist.push(beat(phase, inp.current))
      }
      const n = W * 1.2
      while (hist.length > n) hist.shift()
      ctx.clearRect(0, 0, W, H)
      // monitor grid
      ctx.strokeStyle = 'rgba(127, 227, 196, 0.08)'
      ctx.lineWidth = 1
      for (let x = 0; x < W; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
      for (let y = 0; y < H; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
      // trace
      ctx.strokeStyle = '#7fe3c4'
      ctx.lineWidth = 1.8
      ctx.shadowColor = 'rgba(127,227,196,0.6)'
      ctx.shadowBlur = 6
      ctx.beginPath()
      const base = H * 0.62, amp = H * 0.42
      hist.forEach((v, i) => {
        const x = (i / n) * W
        const y = base - v * amp
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.shadowBlur = 0
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const tags = [
    Number(inputs.q_wave) && 'Q wave', Number(inputs.st_elevation) && 'ST elevation', Number(inputs.st_depression) && 'ST depression',
    Number(inputs.t_inversion) && 'T inversion', Number(inputs.lvh) && 'LVH voltage', inputs.bbb && inputs.bbb !== 'N' && String(inputs.bbb),
  ].filter(Boolean) as string[]

  return (
    <div className="ecg">
      <div className="ecg-head">
        <span>ECG · {Math.round(bpm)} bpm</span>
        <span className="ecg-tags">{tags.length ? tags.join(' · ') : 'no abnormal ECG findings entered'}</span>
      </div>
      <canvas ref={ref} aria-label="Illustrative ECG drawn from the ECG inputs" />
      <div className="ecg-note">Illustrative trace drawn from the ECG inputs, not a recording</div>
    </div>
  )
}
