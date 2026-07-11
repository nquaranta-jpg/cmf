import { useMemo, useState } from 'react'
import type { Assumptions, DealResult, PropertyData, Verdict } from '../../lib/underwriting'
import { buildArticle, renderArticleHtml, renderArticleMarkdown } from '../../lib/report'
import { fmtMoney, fmtNum, fmtPct } from '../../lib/format'
import { Banner, Card, GhostButton, PrimaryButton } from '../ui'

interface Props {
  property: PropertyData
  checklist: Record<string, boolean>
  deal: DealResult
  assumptions: Assumptions
  verdict: Verdict
  savedName: string
  onSave: (name: string) => Promise<void>
}

const verdictStyles = {
  PASS: { badge: 'bg-emerald-600', ring: 'ring-emerald-200' },
  CONDITIONAL: { badge: 'bg-amber-500', ring: 'ring-amber-200' },
  FAIL: { badge: 'bg-red-600', ring: 'ring-red-200' },
}

type RowStatus = 'pass' | 'warn' | 'fail' | 'info'

export default function StageVerdict({ property, checklist, deal, assumptions, verdict, savedName, onSave }: Props) {
  const [name, setName] = useState(savedName)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pdfState, setPdfState] = useState<'idle' | 'working' | 'error'>('idle')
  const [copyState, setCopyState] = useState<'idle' | 'rich' | 'plain' | 'error'>('idle')
  const s = verdictStyles[verdict.verdict]

  const article = useMemo(
    () => buildArticle(property, assumptions, deal, verdict, checklist),
    [property, assumptions, deal, verdict, checklist],
  )

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const fileSlug = (property.address.split(',')[0] || name || 'dealvet-analysis').replace(/[^a-z0-9]+/gi, '-').toLowerCase()

  const downloadPdf = async () => {
    setPdfState('working')
    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ property, assumptions, checklist }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      downloadBlob(await res.blob(), `dealvet-${fileSlug}.pdf`)
      setPdfState('idle')
    } catch {
      setPdfState('error')
    }
  }

  const copyArticle = async () => {
    const html = renderArticleHtml(article)
    const md = renderArticleMarkdown(article)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([md], { type: 'text/plain' }),
        }),
      ])
      setCopyState('rich')
    } catch {
      try {
        await navigator.clipboard.writeText(md)
        setCopyState('plain')
      } catch {
        setCopyState('error')
      }
    }
  }

  const downloadMarkdown = () => {
    downloadBlob(new Blob([renderArticleMarkdown(article)], { type: 'text/markdown' }), `dealvet-${fileSlug}.md`)
  }

  const rows: { metric: string; value: string; threshold: string; status: RowStatus }[] = [
    {
      metric: 'Cap rate',
      value: fmtPct(deal.capRatePct),
      threshold: `good ≥ ${assumptions.capGoodPct}% · poor < ${assumptions.capPoorPct}%`,
      status: deal.capBand === 'good' ? 'pass' : deal.capBand === 'marginal' ? 'warn' : 'fail',
    },
    {
      metric: 'DSCR',
      value: fmtNum(deal.dscr),
      threshold: `pass ≥ ${fmtNum(assumptions.dscrPassAt)} · fail < ${fmtNum(assumptions.dscrFailBelow)}`,
      status: deal.dscrBand === 'pass' ? 'pass' : deal.dscrBand === 'conditional' ? 'warn' : 'fail',
    },
    {
      metric: 'Cash flow before investors',
      value: `${fmtMoney(deal.cashFlowBeforeInvestors)}/yr`,
      threshold: 'must be ≥ $0',
      status: deal.cashFlowBeforeInvestors >= 0 ? 'pass' : 'fail',
    },
    {
      metric: 'Rent upside',
      value: fmtPct(deal.rentUpsidePct, 1),
      threshold: `value-add ≥ ${assumptions.valueAddUpsidePct}%`,
      status: 'info',
    },
    { metric: 'NOI', value: fmtMoney(deal.noi), threshold: '—', status: deal.noi > 0 ? 'pass' : 'fail' },
    { metric: 'Cash-on-cash', value: fmtPct(deal.cashOnCashPct, 1), threshold: '—', status: 'info' },
  ]

  const statusChip = (st: RowStatus) =>
    st === 'pass'
      ? 'bg-emerald-100 text-emerald-800'
      : st === 'warn'
        ? 'bg-amber-100 text-amber-800'
        : st === 'fail'
          ? 'bg-red-100 text-red-800'
          : 'bg-slate-100 text-slate-600'

  const save = async () => {
    setSaveState('saving')
    try {
      await onSave(name.trim() || 'Untitled deal')
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  return (
    <div className="space-y-6">
      <Card className={`ring-4 ${s.ring}`}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className={`rounded-2xl px-8 py-3 text-3xl font-black tracking-wide text-white ${s.badge}`}>
            {verdict.verdict}
          </span>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-700">{verdict.summary}</p>
        </div>
        <ul className="mx-auto mt-2 max-w-2xl list-disc space-y-1 pl-6 text-sm text-slate-600">
          {verdict.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Scorecard">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-3">Metric</th>
                <th className="pb-2 pr-3">Value</th>
                <th className="pb-2 pr-3">Threshold</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.metric} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-700">{r.metric}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.value}</td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{r.threshold}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${statusChip(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-6">
          <Card title="Solve for price — suggested offer ceiling">
            <p className="mb-3 text-sm text-slate-600">
              Holding NOI and your loan terms constant, the highest price at which this deal still passes:
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="py-2 text-slate-600">Max price for DSCR ≥ {fmtNum(assumptions.dscrPassAt)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{fmtMoney(deal.maxPriceForDscr)}</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-2 text-slate-600">Max price for cap ≥ {assumptions.capGoodPct}%</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{fmtMoney(deal.maxPriceForCap)}</td>
                </tr>
                <tr className="border-t-2 border-slate-300 text-base font-bold">
                  <td className="py-3">Offer ceiling (the lower of the two)</td>
                  <td className="py-3 text-right tabular-nums text-indigo-700">{fmtMoney(deal.offerCeiling)}</td>
                </tr>
              </tbody>
            </table>
            {deal.offerCeiling === null && (
              <div className="mt-2">
                <Banner tone="bad">NOI is not positive — no price makes this deal pass with current numbers.</Banner>
              </div>
            )}
          </Card>

          <Card title="Export & publish">
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton onClick={downloadPdf} disabled={pdfState === 'working'}>
                {pdfState === 'working' ? 'Building PDF…' : 'Download PDF report'}
              </PrimaryButton>
              <GhostButton onClick={copyArticle}>
                {copyState === 'rich'
                  ? 'Copied ✓ — paste into Substack'
                  : copyState === 'plain'
                    ? 'Copied as Markdown ✓'
                    : 'Copy Substack article'}
              </GhostButton>
              <GhostButton onClick={downloadMarkdown}>Download .md</GhostButton>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              The article copies as rich text — open a new Substack post and paste; headings and tables carry over.
              Give it a read for voice before publishing.
            </p>
            {pdfState === 'error' && (
              <div className="mt-2">
                <Banner tone="bad">PDF generation failed — is the API server running?</Banner>
              </div>
            )}
            {copyState === 'error' && (
              <div className="mt-2">
                <Banner tone="bad">Clipboard unavailable — use “Download .md” instead.</Banner>
              </div>
            )}
          </Card>

          <Card title="Save this analysis">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. 12 Maple St 4-plex"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaveState('idle')
                }}
              />
              <PrimaryButton onClick={save} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
              </PrimaryButton>
            </div>
            {saveState === 'error' && (
              <div className="mt-2">
                <Banner tone="bad">Save failed — is the API server running?</Banner>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
