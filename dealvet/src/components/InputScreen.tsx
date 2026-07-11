import { useState } from 'react'
import type { AnalysisRecord } from '../api'
import { fmtMoney } from '../lib/format'
import { Banner, Card, GhostButton, PrimaryButton } from './ui'

interface Props {
  history: AnalysisRecord[]
  busy: boolean
  scrapeNote: string | null
  onScrape: (url: string) => void
  onParseText: (text: string) => void
  onManual: () => void
  onSample: () => void
  onOpen: (rec: AnalysisRecord) => void
  onDelete: (id: string) => void
}

const verdictColor: Record<string, string> = {
  PASS: 'bg-emerald-100 text-emerald-800',
  CONDITIONAL: 'bg-amber-100 text-amber-800',
  FAIL: 'bg-red-100 text-red-800',
}

export default function InputScreen({ history, busy, scrapeNote, onScrape, onParseText, onManual, onSample, onOpen, onDelete }: Props) {
  const [url, setUrl] = useState('')
  const [pasteMode, setPasteMode] = useState(false)
  const [pasted, setPasted] = useState('')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card title="Screen a new deal">
        <p className="mb-4 text-sm text-slate-600">
          Paste a listing URL — or the entire listing page text — and DealVet will extract the numbers (best-effort,
          always editable). Manual entry is the fallback.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="https://…  (listing URL, or paste the whole listing text)"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url && onScrape(url)}
          />
          <PrimaryButton onClick={() => onScrape(url)} disabled={!url || busy}>
            {busy ? 'Extracting…' : 'Extract'}
          </PrimaryButton>
        </div>
        {scrapeNote && (
          <div className="mt-3">
            <Banner tone="warn">{scrapeNote}</Banner>
          </div>
        )}
        <button
          type="button"
          onClick={() => setPasteMode(!pasteMode)}
          className="mt-3 text-sm font-medium text-indigo-600 hover:underline"
        >
          {pasteMode ? 'Hide paste mode' : 'Or paste the listing page text (for sites that block scraping)'}
        </button>
        {pasteMode && (
          <div className="mt-2">
            <textarea
              rows={6}
              placeholder="Open the listing in your browser, select all (⌘A), copy (⌘C), and paste everything here…"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div className="mt-2">
              <PrimaryButton onClick={() => onParseText(pasted)} disabled={pasted.trim().length < 20 || busy}>
                {busy ? 'Parsing…' : 'Extract from pasted text'}
              </PrimaryButton>
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <GhostButton onClick={onManual}>Enter manually instead</GhostButton>
          <GhostButton onClick={onSample}>Load a sample 4-unit deal</GhostButton>
        </div>
      </Card>

      <Card title="Saved analyses">
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing saved yet — finished analyses will show up here.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((rec) => (
              <li key={rec.id} className="flex items-center justify-between gap-3 py-3">
                <button type="button" onClick={() => onOpen(rec)} className="min-w-0 flex-1 text-left hover:opacity-70">
                  <div className="truncate text-sm font-semibold text-slate-800">{rec.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {rec.address || 'No address'} · {fmtMoney(rec.price)} · {new Date(rec.createdAt).toLocaleDateString()}
                  </div>
                </button>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${verdictColor[rec.verdict] ?? 'bg-slate-100 text-slate-600'}`}>
                  {rec.verdict}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(rec.id)}
                  className="text-xs text-slate-400 hover:text-red-500"
                  title="Delete"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
