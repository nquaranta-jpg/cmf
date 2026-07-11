import type { Assumptions, DealResult } from '../../lib/underwriting'
import { fmtMoney } from '../../lib/format'
import { Banner, Card, NumField } from '../ui'

interface Props {
  assumptions: Assumptions
  deal: DealResult
  onChange: (a: Assumptions) => void
}

export default function StageOperating({ assumptions, deal, onChange }: Props) {
  const set = <K extends keyof Assumptions>(k: K, v: number | null) => onChange({ ...assumptions, [k]: v ?? 0 })

  const rows: [string, number, boolean?][] = [
    ['Gross scheduled rent (from unit rents)', deal.gsrAnnual],
    [`− Vacancy loss (${assumptions.vacancyPct}%)`, -deal.vacancyLoss],
    ['= Effective gross income', deal.egi, true],
    ['− Property taxes (actual)', -deal.expenses.taxes],
    ['− Insurance', -deal.expenses.insurance],
    ['− Water / sewer', -deal.expenses.waterSewer],
    [`− Maintenance (${assumptions.maintenancePctEGI}% of EGI)`, -deal.expenses.maintenance],
    [`− Management (${assumptions.managementPctEGI}% of EGI)`, -deal.expenses.management],
    [`− CapEx reserve (${fmtMoney(assumptions.capexPerUnitAnnual)}/unit × ${deal.unitCount})`, -deal.expenses.capex],
    ['= Net Operating Income', deal.noi, true],
  ]

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <strong>Stage 2 — The real operating statement.</strong> Listed gross income is never trusted; everything below
        is rebuilt from the unit rents you verified. Every assumption is editable.
      </Banner>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Assumptions (defaults shown — override freely)">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumField label="Vacancy rate" suffix="%" value={assumptions.vacancyPct} onChange={(v) => set('vacancyPct', v)} />
            <NumField label="Insurance (annual)" prefix="$" value={assumptions.insuranceAnnual} onChange={(v) => set('insuranceAnnual', v)} hint="Default estimate: $1,200/unit — get a real quote." />
            <NumField label="Water / sewer (annual)" prefix="$" value={assumptions.waterSewerAnnual} onChange={(v) => set('waterSewerAnnual', v)} />
            <NumField label="Maintenance" suffix="% EGI" value={assumptions.maintenancePctEGI} onChange={(v) => set('maintenancePctEGI', v)} />
            <NumField label="Management" suffix="% EGI" value={assumptions.managementPctEGI} onChange={(v) => set('managementPctEGI', v)} />
            <NumField label="CapEx reserve" prefix="$" suffix="/unit/yr" value={assumptions.capexPerUnitAnnual} onChange={(v) => set('capexPerUnitAnnual', v)} />
          </div>
        </Card>

        <Card title="Operating statement">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([label, value, strong], i) => (
                <tr key={i} className={strong ? 'border-t-2 border-slate-300 font-bold' : 'border-t border-slate-100'}>
                  <td className="py-2 pr-3 text-slate-700">{label}</td>
                  <td className={`py-2 text-right tabular-nums ${value < 0 ? 'text-slate-500' : strong ? (value >= 0 ? 'text-slate-900' : 'text-red-600') : 'text-slate-900'}`}>
                    {fmtMoney(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deal.noi <= 0 && (
            <div className="mt-3">
              <Banner tone="bad">NOI is zero or negative — this property loses money before any debt.</Banner>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
