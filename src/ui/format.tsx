import type { ReactNode } from 'react'

/** 3.2 × 10⁻⁵, with a real superscript */
export function sci(x: number, digits = 1): ReactNode {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const e = Math.floor(Math.log10(Math.abs(x)))
  const m = x / 10 ** e
  if (e >= -1 && e <= 2) return x.toFixed(x < 10 ? 2 : 1)
  return (
    <>
      {m.toFixed(digits)} × 10<sup>{e}</sup>
    </>
  )
}

export function pow10(e: number): ReactNode {
  return (
    <>
      10<sup>{e}</sup>
    </>
  )
}

export function fixed(x: number, d = 1) {
  return Number.isFinite(x) ? x.toFixed(d) : '—'
}

export function int(x: number) {
  return Math.round(x).toLocaleString('en-US')
}
