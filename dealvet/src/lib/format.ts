export const fmtMoney = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits })

export const fmtPct = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}%`

export const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits)
