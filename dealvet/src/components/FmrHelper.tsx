import { useEffect, useMemo, useState } from 'react'
import type { PropertyData } from '../lib/underwriting'
import { fmtMoney } from '../lib/format'
import { Card } from './ui'

// HUD Fair Market Rents, bundled at build time from huduser.gov (see scripts/build-fmr-data.mjs).
// Entry: [state, place name, HUD area name, fmr0, fmr1, fmr2, fmr3, fmr4]
type FmrEntry = [string, string, string, number, number, number, number, number]
interface FmrData {
  year: string
  source: string
  entries: FmrEntry[]
}

const BED_LABELS = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR']

export default function FmrHelper({
  property,
  onChange,
}: {
  property: PropertyData
  onChange: (p: PropertyData) => void
}) {
  const [data, setData] = useState<FmrData | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<FmrEntry | null>(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    import('../data/fmr.json').then((m) => setData(m.default as unknown as FmrData))
  }, [])

  // Seed the search from the property address (city + state) once data loads.
  useEffect(() => {
    if (!data || query) return
    const m = property.address.match(/,\s*([A-Za-z .'-]+?),?\s+([A-Z]{2})\b/)
    if (m) setQuery(`${m[1].trim()} ${m[2]}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const matches = useMemo(() => {
    if (!data || query.trim().length < 2) return []
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const placeTerms = terms.filter((t) => t.length > 2)
    return data.entries
      .filter((e) => {
        const hay = `${e[1]} ${e[2]} ${e[0]}`.toLowerCase()
        return terms.every((t) => hay.includes(t))
      })
      .map((e) => {
        // Rank: state-code match ≫ place name starts with the city ≫ place name contains it.
        const state = e[0].toLowerCase()
        const name = e[1].toLowerCase()
        let score = 0
        if (terms.includes(state)) score += 4
        if (placeTerms.some((t) => name.startsWith(t))) score += 2
        if (placeTerms.some((t) => name.includes(t))) score += 1
        return { e, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => s.e)
  }, [data, query])

  useEffect(() => {
    setSelected(matches.length > 0 ? matches[0] : null)
    setApplied(false)
  }, [matches])

  const fmrForBeds = (beds: number): number | null =>
    selected ? (selected[3 + Math.min(Math.max(Math.round(beds), 0), 4)] as number) : null

  const apply = () => {
    if (!selected) return
    onChange({
      ...property,
      units: property.units.map((u) => ({ ...u, marketRent: fmrForBeds(u.beds) ?? u.marketRent })),
    })
    setApplied(true)
  }

  if (!data) return null

  return (
    <Card title={`Rent anchor — HUD Fair Market Rents (${data.year})`}>
      <p className="mb-3 text-sm text-slate-600">
        A free government baseline, not a comp: FMRs are roughly the 40th percentile of area rents (including a
        utility allowance), so hot submarkets often rent above them. Use it as an anchor, then adjust to your comps.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-1/2">
          <input
            type="text"
            placeholder="Search city / county / area…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="mt-2 space-y-1">
            {matches.map((e, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(e)
                    setApplied(false)
                  }}
                  className={`w-full rounded-lg px-3 py-1.5 text-left text-xs ${
                    selected === e ? 'bg-indigo-50 font-semibold text-indigo-800' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {e[1]}, {e[0]} <span className="text-slate-400">— {e[2]}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && query.trim().length >= 2 && (
              <li className="px-3 py-1.5 text-xs text-slate-400">No matching area — try just the county or city name.</li>
            )}
          </ul>
        </div>
        {selected && (
          <div className="sm:w-1/2">
            <table className="w-full text-sm">
              <tbody>
                {BED_LABELS.map((label, i) => (
                  <tr key={label} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-600">{label}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        property.units.some((u) => Math.min(Math.round(u.beds), 4) === i)
                          ? 'font-bold text-indigo-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {fmtMoney(selected[3 + i] as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={apply}
              className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              {applied ? 'Applied ✓ — now adjust to your comps' : 'Apply FMR to all units as a starting point'}
            </button>
          </div>
        )}
      </div>
    </Card>
  )
}
