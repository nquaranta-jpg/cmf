import type { Assumptions, DealResult } from '../../lib/underwriting'
import { fmtMoney, fmtPct } from '../../lib/format'
import { Banner, Card, NumField, Stat } from '../ui'

interface Props {
  assumptions: Assumptions
  deal: DealResult
  onChange: (a: Assumptions) => void
}

export default function StageCapRate({ assumptions, deal, onChange }: Props) {
  const set = <K extends keyof Assumptions>(k: K, v: number | null) => onChange({ ...assumptions, [k]: v ?? 0 })

  const band = deal.capBand
  const tone = band === 'good' ? 'good' : band === 'marginal' ? 'warn' : band === 'poor' ? 'bad' : 'neutral'
  const bandLabel = band === 'good' ? 'Good' : band === 'marginal' ? 'Marginal' : band === 'poor' ? 'Poor' : '—'

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <strong>Stage 3 — Cap rate.</strong> NOI ÷ price: what the building earns unlevered. The band thresholds are
        yours to tune to your market.
      </Banner>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-col items-center py-6">
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Cap rate</div>
            <div className={`mt-2 text-6xl font-black tabular-nums ${tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-500' : tone === 'bad' ? 'text-red-600' : 'text-slate-400'}`}>
              {fmtPct(deal.capRatePct)}
            </div>
            <div className={`mt-3 rounded-full px-4 py-1 text-sm font-bold ${tone === 'good' ? 'bg-emerald-100 text-emerald-800' : tone === 'warn' ? 'bg-amber-100 text-amber-800' : tone === 'bad' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-500'}`}>
              {bandLabel}
            </div>
            <div className="mt-4 text-sm text-slate-500">{fmtMoney(deal.noi)} NOI ÷ purchase price</div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Your band (editable)">
            <div className="space-y-3">
              <NumField label="Good at or above" suffix="%" step={0.1} value={assumptions.capGoodPct} onChange={(v) => set('capGoodPct', v)} />
              <NumField label="Poor below" suffix="%" step={0.1} value={assumptions.capPoorPct} onChange={(v) => set('capPoorPct', v)} />
            </div>
          </Card>
          <Stat label="NOI" value={fmtMoney(deal.noi)} tone={deal.noi > 0 ? 'neutral' : 'bad'} sub="from Stage 2" />
        </div>
      </div>
    </div>
  )
}
