import { CHECKLIST_ITEMS, type DealResult, type PropertyData } from '../../lib/underwriting'
import { Banner, Card } from '../ui'

interface Props {
  property: PropertyData
  deal: DealResult
  checklist: Record<string, boolean>
  onChange: (c: Record<string, boolean>) => void
}

export default function StageChecklist({ property, deal, checklist, onChange }: Props) {
  const done = CHECKLIST_ITEMS.filter((i) => checklist[i.key]).length

  return (
    <div className="space-y-6">
      <Banner tone="info">
        <strong>Stage 5 — Due diligence.</strong> These are human gates, not math. Nothing here is optional on a real
        deal; an unfinished checklist caps the verdict at CONDITIONAL.
      </Banner>

      {deal.warnings.length > 0 && (
        <Card title="Auto-generated warnings from this property's data">
          <ul className="space-y-2">
            {deal.warnings.map((w, i) => (
              <li key={i}>
                <Banner tone="warn">{w}</Banner>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Checklist (${done}/${CHECKLIST_ITEMS.length} acknowledged)`}>
        <ul className="divide-y divide-slate-100">
          {CHECKLIST_ITEMS.map((item) => {
            const flag = item.autoFlag?.(property) ?? null
            const checked = !!checklist[item.key]
            return (
              <li key={item.key} className="flex items-start gap-3 py-3">
                <input
                  id={`chk-${item.key}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChange({ ...checklist, [item.key]: e.target.checked })}
                  className="mt-0.5 h-5 w-5 rounded border-slate-300 accent-indigo-600"
                />
                <label htmlFor={`chk-${item.key}`} className="flex-1 cursor-pointer">
                  <span className={`text-sm ${checked ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.label}</span>
                  {flag && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{flag}</span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
