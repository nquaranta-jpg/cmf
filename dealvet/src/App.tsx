import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CHECKLIST_ITEMS,
  computeDeal,
  computeVerdict,
  defaultAssumptions,
  type Assumptions,
  type PropertyData,
} from './lib/underwriting'
import {
  deleteAnalysis,
  listAnalyses,
  parseListingText,
  saveAnalysis,
  scrapeUrl,
  type AnalysisRecord,
  type ScrapeResponse,
} from './api'
import InputScreen from './components/InputScreen'
import PropertyForm from './components/PropertyForm'
import StageIncome from './components/stages/StageIncome'
import StageOperating from './components/stages/StageOperating'
import StageCapRate from './components/stages/StageCapRate'
import StageDebt from './components/stages/StageDebt'
import StageChecklist from './components/stages/StageChecklist'
import StageVerdict from './components/stages/StageVerdict'
import { GhostButton, PrimaryButton } from './components/ui'

const STEPS = ['Property data', 'Income sanity', 'Operating statement', 'Cap rate', 'Debt & DSCR', 'Due diligence', 'Verdict']

function blankProperty(unitCount = 2): PropertyData {
  return {
    address: '',
    price: 0,
    yearBuilt: null,
    sqft: null,
    lotSize: '',
    parkingSpaces: null,
    heatType: '',
    utilitiesPaidBy: 'tenant',
    annualTaxes: 0,
    listedGrossIncome: null,
    units: Array.from({ length: unitCount }, (_, i) => ({
      label: `Unit ${i + 1}`,
      beds: 2,
      baths: 1,
      currentRent: 0,
      marketRent: 0,
    })),
  }
}

function sampleProperty(): PropertyData {
  return {
    address: '48 Ellsworth Ave, Sample City',
    price: 675_000,
    yearBuilt: 1962,
    sqft: 4100,
    lotSize: '0.21 acres',
    parkingSpaces: 4,
    heatType: 'forced air gas',
    utilitiesPaidBy: 'tenant',
    annualTaxes: 8100,
    listedGrossIncome: 78_000,
    units: [
      { label: 'Unit 1', beds: 2, baths: 1, currentRent: 1450, marketRent: 1700 },
      { label: 'Unit 2', beds: 2, baths: 1, currentRent: 1450, marketRent: 1700 },
      { label: 'Unit 3', beds: 2, baths: 1, currentRent: 1500, marketRent: 1700 },
      { label: 'Unit 4', beds: 1, baths: 1, currentRent: 1200, marketRent: 1350 },
    ],
  }
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'wizard'>('home')
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [property, setProperty] = useState<PropertyData>(blankProperty)
  const [assumptions, setAssumptions] = useState<Assumptions>(() => defaultAssumptions(2))
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [unverified, setUnverified] = useState<Set<string>>(new Set())
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [analysisName, setAnalysisName] = useState('')
  const [history, setHistory] = useState<AnalysisRecord[]>([])
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [scrapeNote, setScrapeNote] = useState<string | null>(null)

  const deal = useMemo(() => computeDeal(property, assumptions), [property, assumptions])
  const checklistComplete = CHECKLIST_ITEMS.every((i) => checklist[i.key])
  const verdict = useMemo(() => computeVerdict(deal, assumptions, checklistComplete), [deal, assumptions, checklistComplete])

  const refreshHistory = useCallback(() => {
    listAnalyses().then(setHistory).catch(() => setHistory([]))
  }, [])
  useEffect(refreshHistory, [refreshHistory])

  const startWizard = (p: PropertyData, unverifiedFields: Set<string>) => {
    setProperty(p)
    setAssumptions(defaultAssumptions(p.units.length))
    setChecklist({})
    setUnverified(unverifiedFields)
    setAnalysisId(null)
    setAnalysisName('')
    setStep(0)
    setMaxStep(0)
    setScreen('wizard')
  }

  const applyExtraction = (res: ScrapeResponse) => {
    if (!res.ok) {
      setScrapeNote(res.note)
      return
    }
    const f = res.fields
    const unitCount =
      f.unitCount && f.unitCount >= 1 && f.unitCount <= 60 ? f.unitCount : Math.max(f.units?.length ?? 0, 2)
    const p = blankProperty(unitCount)
    if (f.address) p.address = f.address
    if (f.price) p.price = f.price
    if (f.yearBuilt) p.yearBuilt = f.yearBuilt
    if (f.sqft) p.sqft = f.sqft
    if (f.annualTaxes) p.annualTaxes = f.annualTaxes
    if (f.listedGrossIncome) p.listedGrossIncome = f.listedGrossIncome
    if (f.heatType) p.heatType = f.heatType
    if (f.lotSize) p.lotSize = f.lotSize
    if (f.parkingSpaces) p.parkingSpaces = f.parkingSpaces
    if (f.units?.length) {
      p.units = p.units.map((u, i) => {
        const s = f.units![i]
        return s ? { ...u, beds: s.beds ?? u.beds, baths: s.baths ?? u.baths, currentRent: s.currentRent ?? 0 } : u
      })
    }
    startWizard(p, new Set(res.found))
  }

  const handleScrape = async (url: string) => {
    setScrapeBusy(true)
    setScrapeNote(null)
    try {
      const res = await scrapeUrl(url)
      if (!res.ok) {
        res.note += ' Tip: open the listing in your browser, select-all and copy the page, then use “Paste listing text” below.'
      }
      applyExtraction(res)
    } catch {
      setScrapeNote('The extractor could not reach the server — enter the details manually.')
    } finally {
      setScrapeBusy(false)
    }
  }

  const handleParseText = async (text: string) => {
    setScrapeBusy(true)
    setScrapeNote(null)
    try {
      applyExtraction(await parseListingText(text))
    } catch {
      setScrapeNote('The parser could not reach the server — enter the details manually.')
    } finally {
      setScrapeBusy(false)
    }
  }

  const openSaved = (rec: AnalysisRecord) => {
    setProperty(rec.property)
    setAssumptions(rec.assumptions)
    setChecklist(rec.checklist ?? {})
    setUnverified(new Set())
    setAnalysisId(rec.id)
    setAnalysisName(rec.name)
    setStep(STEPS.length - 1)
    setMaxStep(STEPS.length - 1)
    setScreen('wizard')
  }

  const handleDelete = async (id: string) => {
    await deleteAnalysis(id)
    refreshHistory()
  }

  const handleSave = async (name: string) => {
    const id = analysisId ?? crypto.randomUUID()
    await saveAnalysis({
      id,
      name,
      createdAt: new Date().toISOString(),
      verdict: verdict.verdict,
      address: property.address,
      price: property.price,
      property,
      assumptions,
      checklist,
    })
    setAnalysisId(id)
    setAnalysisName(name)
    refreshHistory()
  }

  // Per-step gating
  const propertyValid =
    property.price > 0 && property.units.length > 0 && property.units.every((u) => u.currentRent > 0)
  const marketRentsEntered = property.units.every((u) => u.marketRent > 0)
  const nextBlocked =
    step === 0
      ? unverified.size > 0 || !propertyValid
      : step === 1
        ? !marketRentsEntered
        : false
  const blockReason =
    step === 0 && unverified.size > 0
      ? 'Confirm every unverified field first'
      : step === 0 && !propertyValid
        ? 'Price and a current rent for every unit are required'
        : step === 1 && !marketRentsEntered
          ? 'Enter a market rent for every unit — this is the one input DealVet won’t guess'
          : null

  if (screen === 'home') {
    return (
      <Shell>
        <InputScreen
          history={history}
          busy={scrapeBusy}
          scrapeNote={scrapeNote}
          onScrape={handleScrape}
          onParseText={handleParseText}
          onManual={() => startWizard(blankProperty(), new Set())}
          onSample={() => startWizard(sampleProperty(), new Set())}
          onOpen={openSaved}
          onDelete={handleDelete}
        />
      </Shell>
    )
  }

  return (
    <Shell
      onHome={() => {
        setScreen('home')
        setScrapeNote(null)
        refreshHistory()
      }}
    >
      <div className="mx-auto max-w-5xl">
        {/* Stepper */}
        <ol className="mb-8 flex flex-wrap items-center gap-1 text-xs font-medium">
          {STEPS.map((label, i) => {
            const reachable = i <= maxStep
            const current = i === step
            return (
              <li key={label} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-300">—</span>}
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => setStep(i)}
                  className={`rounded-full px-3 py-1.5 transition ${
                    current
                      ? 'bg-indigo-600 text-white'
                      : reachable
                        ? 'bg-white text-slate-600 shadow-sm hover:bg-indigo-50'
                        : 'text-slate-400'
                  }`}
                >
                  {i + 1}. {label}
                </button>
              </li>
            )
          })}
        </ol>

        {step === 0 && (
          <PropertyForm
            property={property}
            unverified={unverified}
            onChange={setProperty}
            onConfirm={(f) => setUnverified((s) => { const n = new Set(s); n.delete(f); return n })}
            onConfirmAll={() => setUnverified(new Set())}
          />
        )}
        {step === 1 && <StageIncome property={property} assumptions={assumptions} deal={deal} onChange={setProperty} />}
        {step === 2 && <StageOperating assumptions={assumptions} deal={deal} onChange={setAssumptions} />}
        {step === 3 && <StageCapRate assumptions={assumptions} deal={deal} onChange={setAssumptions} />}
        {step === 4 && <StageDebt assumptions={assumptions} deal={deal} onChange={setAssumptions} />}
        {step === 5 && <StageChecklist property={property} deal={deal} checklist={checklist} onChange={setChecklist} />}
        {step === 6 && (
          <StageVerdict
            property={property}
            checklist={checklist}
            deal={deal}
            assumptions={assumptions}
            verdict={verdict}
            savedName={analysisName}
            onSave={handleSave}
          />
        )}

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between">
          <div>{step > 0 && <GhostButton onClick={() => setStep(step - 1)}>← Back</GhostButton>}</div>
          <div className="flex items-center gap-3">
            {blockReason && <span className="text-xs font-medium text-amber-600">{blockReason}</span>}
            {step < STEPS.length - 1 && (
              <PrimaryButton
                disabled={nextBlocked}
                onClick={() => {
                  const next = step + 1
                  setStep(next)
                  setMaxStep(Math.max(maxStep, next))
                }}
              >
                Next: {STEPS[step + 1]} →
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children, onHome }: { children: React.ReactNode; onHome?: () => void }) {
  return (
    <div className="min-h-screen pb-16">
      <header className="mb-8 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <button type="button" onClick={onHome} className="flex items-center gap-2 text-left" disabled={!onHome}>
            <span className="rounded-lg bg-indigo-600 px-2 py-1 text-sm font-black text-white">DV</span>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              DealVet <span className="text-sm font-normal text-slate-500">— multifamily deal screener</span>
            </span>
          </button>
          {onHome && (
            <button type="button" onClick={onHome} className="text-sm font-medium text-indigo-600 hover:underline">
              ← All deals
            </button>
          )}
        </div>
      </header>
      <main className="px-4">{children}</main>
    </div>
  )
}
