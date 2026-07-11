import type { Assumptions, DealResult, PropertyData } from '../../lib/underwriting'
import { fmtMoney, fmtNum, fmtPct } from '../../lib/format'
import FmrHelper from '../FmrHelper'
import { Banner, Card, Stat } from '../ui'

interface Props {
  property: PropertyData
  assumptions: Assumptions
  deal: DealResult
  onChange: (p: PropertyData) => void
}

export default function StageIncome({ property, assumptions, deal, onChange }: Props) {
  const setMarket = (i: number, v: number) => {
    onChange({ ...property, units: property.units.map((u, j) => (j === i ? { ...u, marketRent: v } : u)) })
  }
  const applyToAll = (v: number) => {
    onChange({ ...property, units: property.units.map((u) => ({ ...u, marketRent: v })) })
  }

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <strong>Stage 1 — Income sanity check.</strong> Market rent is the crux of every deal. The HUD anchor below
        gives you a defensible starting point; your own comps should have the final word.
      </Banner>

      <FmrHelper property={property} onChange={onChange} />

      <Card title="Market rent vs. current rent">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2 pr-3">Unit</th>
              <th className="pb-2 pr-3">Current /mo</th>
              <th className="pb-2 pr-3">Your market rent estimate /mo</th>
              <th className="pb-2">Gap</th>
            </tr>
          </thead>
          <tbody>
            {property.units.map((u, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-medium text-slate-700">
                  {u.label} <span className="text-xs text-slate-400">({u.beds}bd/{u.baths}ba)</span>
                </td>
                <td className="py-2 pr-3">{fmtMoney(u.currentRent)}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-md border border-slate-300">
                      <span className="pl-2 text-slate-400">$</span>
                      <input
                        type="number"
                        className="w-28 border-0 px-2 py-1.5 outline-none"
                        value={u.marketRent || ''}
                        onChange={(e) => setMarket(i, Number(e.target.value))}
                      />
                    </div>
                    {i === 0 && u.marketRent > 0 && property.units.length > 1 && (
                      <button type="button" onClick={() => applyToAll(u.marketRent)} className="text-xs text-indigo-600 hover:underline">
                        apply to all
                      </button>
                    )}
                  </div>
                </td>
                <td className={`py-2 text-sm font-semibold ${u.marketRent - u.currentRent > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {u.marketRent > 0 ? fmtMoney(u.marketRent - u.currentRent) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Gross Rent Multiplier" value={fmtNum(deal.grm, 1)} sub={`Price ÷ ${fmtMoney(deal.gsrAnnual)} annual rent`} />
        <Stat label="Gross yield" value={fmtPct(deal.grossYieldPct, 1)} sub="Annual gross rent ÷ price" />
        <Stat
          label="Rent upside"
          value={fmtPct(deal.rentUpsidePct, 1)}
          tone={deal.rentUpsidePct === null ? 'neutral' : deal.rentUpsidePct >= assumptions.valueAddUpsidePct ? 'good' : deal.rentUpsidePct < assumptions.limitedUpsidePct ? 'warn' : 'neutral'}
          sub="(market − current) ÷ current"
        />
        <Stat label="Market rent /mo" value={fmtMoney(deal.monthlyMarketRent)} sub={`vs ${fmtMoney(deal.monthlyCurrentRent)} current`} />
      </div>

      {deal.incomeFlags.map((f, i) => (
        <Banner key={i} tone={f.includes('value-add candidate') ? 'good' : 'warn'}>
          {f}
        </Banner>
      ))}
    </div>
  )
}
