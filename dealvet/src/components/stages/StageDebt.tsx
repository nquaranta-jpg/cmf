import type { Assumptions, DealResult } from '../../lib/underwriting'
import { fmtMoney, fmtNum, fmtPct } from '../../lib/format'
import { Banner, Card, NumField, Stat } from '../ui'

interface Props {
  assumptions: Assumptions
  deal: DealResult
  onChange: (a: Assumptions) => void
}

export default function StageDebt({ assumptions, deal, onChange }: Props) {
  const set = <K extends keyof Assumptions>(k: K, v: number | null) => onChange({ ...assumptions, [k]: v ?? 0 })

  const dscrTone = deal.dscrBand === 'pass' ? 'good' : deal.dscrBand === 'conditional' ? 'warn' : deal.dscrBand === 'fail' ? 'bad' : 'neutral'

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <strong>Stage 4 — Debt &amp; DSCR: the syndication killer.</strong> Lenders underwrite to DSCR before anything
        else. Below {fmtNum(assumptions.dscrFailBelow)} the deal is dead; {fmtNum(assumptions.dscrFailBelow)}–
        {fmtNum(assumptions.dscrPassAt)} is conditional; {fmtNum(assumptions.dscrPassAt)}+ passes.
      </Banner>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Loan assumptions (editable)">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumField label="Down payment" suffix="%" value={assumptions.downPaymentPct} onChange={(v) => set('downPaymentPct', v)} />
            <NumField label="Interest rate" suffix="%" step={0.125} value={assumptions.interestRatePct} onChange={(v) => set('interestRatePct', v)} />
            <NumField label="Amortization" suffix="yrs" value={assumptions.amortYears} onChange={(v) => set('amortYears', v)} />
          </div>
          <table className="mt-5 w-full text-sm">
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="py-2 text-slate-600">Down payment</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(deal.downPayment)}</td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="py-2 text-slate-600">Loan amount</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(deal.loanAmount)}</td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="py-2 text-slate-600">Monthly payment (P&amp;I)</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(deal.monthlyDebtPayment, 2)}</td>
              </tr>
              <tr className="border-t-2 border-slate-300 font-bold">
                <td className="py-2">Annual debt service</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(deal.annualDebtService)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="DSCR" value={fmtNum(deal.dscr)} tone={dscrTone} sub={`NOI ÷ debt service · pass ≥ ${fmtNum(assumptions.dscrPassAt)}`} />
            <Stat
              label="Cash flow before investors"
              value={fmtMoney(deal.cashFlowBeforeInvestors)}
              tone={deal.cashFlowBeforeInvestors >= 0 ? 'good' : 'bad'}
              sub="NOI − debt service, per year"
            />
            <Stat label="Cash-on-cash" value={fmtPct(deal.cashOnCashPct, 1)} sub="CF ÷ down payment" />
            <Stat label="NOI" value={fmtMoney(deal.noi)} sub="from Stage 2" />
          </div>

          {deal.cashFlowBeforeInvestors < 0 && (
            <Banner tone="bad">
              <strong>Negative cash flow before investors.</strong> You would feed this property{' '}
              {fmtMoney(-deal.cashFlowBeforeInvestors)} a year before a single dollar reaches an LP. This alone fails
              the deal.
            </Banner>
          )}
          {deal.dscrBand === 'fail' && (
            <Banner tone="bad">
              DSCR {fmtNum(deal.dscr)} is below {fmtNum(assumptions.dscrFailBelow)} — most lenders will not write this
              loan at this price.
            </Banner>
          )}
          {deal.dscrBand === 'conditional' && (
            <Banner tone="warn">
              DSCR {fmtNum(deal.dscr)} is in the conditional band — financeable, but thin. Rate movement or one bad
              month eats the margin.
            </Banner>
          )}
        </div>
      </div>
    </div>
  )
}
