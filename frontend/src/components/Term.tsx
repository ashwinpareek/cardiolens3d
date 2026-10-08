import { useId, useState, type ReactNode } from 'react'
import { GLOSSARY } from '../lib/glossary'

/** Dotted-underlined term with a plain-language definition on hover, focus or tap. */
export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const def = GLOSSARY[k as string]
  if (!def) return <>{children ?? k}</>
  return (
    <span className="term" tabIndex={0} aria-describedby={id}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}>
      {children ?? k}
      <span role="tooltip" id={id} className={`term-tip ${open ? 'open' : ''}`}>{def}</span>
    </span>
  )
}
