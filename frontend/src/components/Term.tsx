import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GLOSSARY } from '../lib/glossary'

const TIP_W = 280

/** Dotted-underlined term with a plain-language definition on hover, focus or tap.
 *  The tooltip is portalled to <body> with fixed positioning and clamped to the viewport, so a
 *  scrolling side panel or the edge of the screen can never cut it off. */
export function Term({ k, children }: { k: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const id = useId()
  const def = GLOSSARY[k]

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const place = () => {
      const r = ref.current!.getBoundingClientRect()
      const h = tip.current?.offsetHeight ?? 90
      const left = Math.min(Math.max(8, r.left + r.width / 2 - TIP_W / 2), window.innerWidth - TIP_W - 8)
      const below = r.top - h - 10 < 8
      setPos({ left, top: below ? r.bottom + 8 : r.top - h - 8, below })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  if (!def) return <>{children ?? k}</>
  return (
    <span ref={ref} className="term" tabIndex={0} aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onPointerUp={(e) => { if (e.pointerType === 'touch') setOpen((o) => !o) }}>
      {children ?? k}
      {open && createPortal(
        <span ref={tip} role="tooltip" id={id} className="term-tip open"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: TIP_W }}>
          {def}
        </span>,
        document.body,
      )}
    </span>
  )
}

/** A feature's display label wrapped in its glossary definition. */
export function FL({ k, label }: { k: string; label: ReactNode }) {
  return <Term k={k}>{label}</Term>
}
