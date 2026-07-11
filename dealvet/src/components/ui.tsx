import type { ReactNode } from 'react'

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 text-lg font-semibold text-slate-800">{title}</h2>}
      {children}
    </div>
  )
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const tones = {
    info: 'border-sky-300 bg-sky-50 text-sky-900',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    bad: 'border-red-300 bg-red-50 text-red-900',
    good: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  }
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>
}

interface NumFieldProps {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  prefix?: string
  suffix?: string
  step?: number
  hint?: string
  unverified?: boolean
  onConfirm?: () => void
  allowEmpty?: boolean
}

export function NumField({ label, value, onChange, prefix, suffix, step, hint, unverified, onConfirm, allowEmpty }: NumFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
        {label}
        {unverified && (
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200"
            title="Scraped from the listing — click to confirm it's correct"
          >
            unverified — confirm ✓
          </button>
        )}
      </span>
      <div className={`flex items-center overflow-hidden rounded-lg border bg-white focus-within:ring-2 focus-within:ring-indigo-400 ${unverified ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-300'}`}>
        {prefix && <span className="pl-3 text-slate-400">{prefix}</span>}
        <input
          type="number"
          step={step ?? 'any'}
          className="w-full border-0 px-3 py-2 text-sm outline-none"
          value={value === null || Number.isNaN(value) ? '' : value}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') onChange(allowEmpty ? null : 0)
            else onChange(Number(raw))
          }}
        />
        {suffix && <span className="pr-3 text-slate-400">{suffix}</span>}
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  unverified?: boolean
  onConfirm?: () => void
}

export function TextField({ label, value, onChange, placeholder, unverified, onConfirm }: TextFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
        {label}
        {unverified && (
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200"
          >
            unverified — confirm ✓
          </button>
        )}
      </span>
      <input
        type="text"
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400 ${unverified ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-300'}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <select
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Stat({ label, value, tone = 'neutral', sub }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' | 'bad'; sub?: string }) {
  const tones = {
    neutral: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      {children}
    </button>
  )
}
