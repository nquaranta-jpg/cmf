// DealVet underwriting engine — pure functions, no I/O.
// Every constant here is a *default*; the UI must always let the user override it.

export interface UnitInfo {
  label: string
  beds: number
  baths: number
  /** Monthly rent actually being collected today */
  currentRent: number
  /** Monthly market rent — user-supplied from their own comps, never automated */
  marketRent: number
}

export type UtilitiesPayer = 'owner' | 'tenant' | 'mixed'

export interface PropertyData {
  address: string
  price: number
  yearBuilt: number | null
  sqft: number | null
  lotSize: string
  parkingSpaces: number | null
  heatType: string
  utilitiesPaidBy: UtilitiesPayer
  annualTaxes: number
  /** Reference only — the math NEVER uses this figure; income is rebuilt from unit rents */
  listedGrossIncome: number | null
  units: UnitInfo[]
}

export interface Assumptions {
  vacancyPct: number
  insuranceAnnual: number
  waterSewerAnnual: number
  maintenancePctEGI: number
  managementPctEGI: number
  capexPerUnitAnnual: number
  downPaymentPct: number
  interestRatePct: number
  amortYears: number
  // Thresholds (editable bands)
  capGoodPct: number
  capPoorPct: number
  dscrFailBelow: number
  dscrPassAt: number
  /** Rent upside below this % ⇒ "limited value-add" warning */
  limitedUpsidePct: number
  /** Rent upside at/above this % ⇒ "value-add candidate" tag */
  valueAddUpsidePct: number
}

export function defaultAssumptions(unitCount: number): Assumptions {
  const units = Math.max(unitCount, 1)
  return {
    vacancyPct: 6,
    insuranceAnnual: units * 1200,
    waterSewerAnnual: units * 500,
    maintenancePctEGI: 10,
    managementPctEGI: 9,
    capexPerUnitAnnual: 300,
    downPaymentPct: 25,
    interestRatePct: 6.5,
    amortYears: 30,
    capGoodPct: 6.5,
    capPoorPct: 5,
    dscrFailBelow: 1.2,
    dscrPassAt: 1.25,
    limitedUpsidePct: 5,
    valueAddUpsidePct: 15,
  }
}

/** Standard amortizing mortgage payment. Returns the monthly payment. */
export function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0
  const n = years * 12
  const r = annualRatePct / 100 / 12
  if (r === 0) return principal / n
  return (principal * r) / (1 - Math.pow(1 + r, -n))
}

export interface ExpenseBreakdown {
  taxes: number
  insurance: number
  waterSewer: number
  maintenance: number
  management: number
  capex: number
  total: number
}

export interface DealResult {
  unitCount: number
  monthlyCurrentRent: number
  monthlyMarketRent: number
  // Stage 1 — income sanity
  gsrAnnual: number
  grm: number | null
  grossYieldPct: number | null
  rentUpsidePct: number | null
  incomeFlags: string[]
  // Stage 2 — operating statement
  vacancyLoss: number
  egi: number
  expenses: ExpenseBreakdown
  noi: number
  // Stage 3 — cap rate
  capRatePct: number | null
  capBand: 'good' | 'marginal' | 'poor' | null
  // Stage 4 — debt
  loanAmount: number
  downPayment: number
  monthlyDebtPayment: number
  annualDebtService: number
  dscr: number | null
  dscrBand: 'pass' | 'conditional' | 'fail' | null
  cashFlowBeforeInvestors: number
  cashOnCashPct: number | null
  // Stage 6 — solve for price
  maxPriceForDscr: number | null
  maxPriceForCap: number | null
  offerCeiling: number | null
  // Stage 5 — data-driven warnings
  warnings: string[]
}

export function computeDeal(p: PropertyData, a: Assumptions): DealResult {
  const unitCount = p.units.length
  const monthlyCurrentRent = p.units.reduce((s, u) => s + (u.currentRent || 0), 0)
  const monthlyMarketRent = p.units.reduce((s, u) => s + (u.marketRent || 0), 0)

  // Stage 1 — income sanity check
  const gsrAnnual = monthlyCurrentRent * 12
  const grm = gsrAnnual > 0 && p.price > 0 ? p.price / gsrAnnual : null
  const grossYieldPct = p.price > 0 && gsrAnnual > 0 ? (gsrAnnual / p.price) * 100 : null
  const rentUpsidePct =
    monthlyCurrentRent > 0 && monthlyMarketRent > 0
      ? ((monthlyMarketRent - monthlyCurrentRent) / monthlyCurrentRent) * 100
      : null

  const incomeFlags: string[] = []
  if (rentUpsidePct !== null) {
    if (rentUpsidePct < a.limitedUpsidePct) {
      incomeFlags.push(
        `Current rents are at or above market (upside ${rentUpsidePct.toFixed(1)}%) — limited value-add. The deal must work on price alone.`,
      )
    } else if (rentUpsidePct >= a.valueAddUpsidePct) {
      incomeFlags.push(
        `Rent upside of ${rentUpsidePct.toFixed(1)}% — value-add candidate. Verify market rents with your own comps before counting on this.`,
      )
    }
  }

  // Stage 2 — rebuild the operating statement from unit rents (never the listed gross)
  const vacancyLoss = gsrAnnual * (a.vacancyPct / 100)
  const egi = gsrAnnual - vacancyLoss
  const maintenance = egi * (a.maintenancePctEGI / 100)
  const management = egi * (a.managementPctEGI / 100)
  const capex = a.capexPerUnitAnnual * unitCount
  const expenses: ExpenseBreakdown = {
    taxes: p.annualTaxes,
    insurance: a.insuranceAnnual,
    waterSewer: a.waterSewerAnnual,
    maintenance,
    management,
    capex,
    total: p.annualTaxes + a.insuranceAnnual + a.waterSewerAnnual + maintenance + management + capex,
  }
  const noi = egi - expenses.total

  // Stage 3 — cap rate
  const capRatePct = p.price > 0 ? (noi / p.price) * 100 : null
  const capBand =
    capRatePct === null ? null : capRatePct >= a.capGoodPct ? 'good' : capRatePct >= a.capPoorPct ? 'marginal' : 'poor'

  // Stage 4 — debt & DSCR
  const downPayment = p.price * (a.downPaymentPct / 100)
  const loanAmount = p.price - downPayment
  const monthlyDebtPayment = monthlyPayment(loanAmount, a.interestRatePct, a.amortYears)
  const annualDebtService = monthlyDebtPayment * 12
  const dscr = annualDebtService > 0 ? noi / annualDebtService : null
  const dscrBand =
    dscr === null ? null : dscr >= a.dscrPassAt ? 'pass' : dscr >= a.dscrFailBelow ? 'conditional' : 'fail'
  const cashFlowBeforeInvestors = noi - annualDebtService
  const cashOnCashPct = downPayment > 0 ? (cashFlowBeforeInvestors / downPayment) * 100 : null

  // Stage 6 helper — solve for the max price that still passes.
  // NOI does not depend on price (taxes are entered as actuals), so both constraints are closed-form:
  //   DSCR:  NOI / (price · (1−dp) · pmtFactor · 12) ≥ dscrPassAt
  //   Cap:   NOI / price ≥ capGoodPct
  const n = a.amortYears * 12
  const r = a.interestRatePct / 100 / 12
  const pmtFactorMonthly = n <= 0 ? 0 : r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n))
  const annualDebtPerDollarOfPrice = (1 - a.downPaymentPct / 100) * pmtFactorMonthly * 12
  const maxPriceForDscr =
    noi > 0 && annualDebtPerDollarOfPrice > 0 ? noi / (a.dscrPassAt * annualDebtPerDollarOfPrice) : null
  const maxPriceForCap = noi > 0 && a.capGoodPct > 0 ? noi / (a.capGoodPct / 100) : null
  const offerCeiling =
    maxPriceForDscr !== null && maxPriceForCap !== null ? Math.min(maxPriceForDscr, maxPriceForCap) : null

  const warnings = generateWarnings(p, gsrAnnual)

  return {
    unitCount,
    monthlyCurrentRent,
    monthlyMarketRent,
    gsrAnnual,
    grm,
    grossYieldPct,
    rentUpsidePct,
    incomeFlags,
    vacancyLoss,
    egi,
    expenses,
    noi,
    capRatePct,
    capBand,
    loanAmount,
    downPayment,
    monthlyDebtPayment,
    annualDebtService,
    dscr,
    dscrBand,
    cashFlowBeforeInvestors,
    cashOnCashPct,
    maxPriceForDscr,
    maxPriceForCap,
    offerCeiling,
    warnings,
  }
}

/** Data-driven due-diligence warnings (Stage 5). */
export function generateWarnings(p: PropertyData, gsrAnnual: number): string[] {
  const w: string[] = []
  if (p.yearBuilt !== null && p.yearBuilt < 1978) {
    w.push('Built before 1978 — federal lead paint disclosure applies. Review it before offering.')
  }
  if (p.yearBuilt !== null && p.yearBuilt < 1940) {
    w.push('Built before 1940 — verify wiring (knob-and-tube) and plumbing; insurers may decline or surcharge.')
  }
  const heat = p.heatType.toLowerCase()
  const ownerHeatRisk = heat.includes('baseboard') || heat.includes('hot water') || heat.includes('steam') || heat.includes('oil')
  if (ownerHeatRisk && p.utilitiesPaidBy !== 'tenant') {
    w.push('Owner-paid heat suspected (baseboard/hot-water/steam/oil + owner-paid utilities) — confirm who pays heat. This is a $4–6k/yr swing on NOI.')
  }
  if (p.listedGrossIncome !== null && gsrAnnual > 0 && p.listedGrossIncome > gsrAnnual * 1.05) {
    w.push(`Listing claims $${Math.round(p.listedGrossIncome).toLocaleString()} gross income but unit rents support only $${Math.round(gsrAnnual).toLocaleString()} — listing income appears overstated. The math here uses unit rents.`)
  }
  return w
}

export interface ChecklistItem {
  key: string
  label: string
  /** Returns a flag note when the property data makes this item high-priority */
  autoFlag?: (p: PropertyData) => string | null
}

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: 'legalUse', label: 'Legal use of all units confirmed (permitted or grandfathered)' },
  {
    key: 'leadPaint',
    label: 'Lead paint disclosure reviewed',
    autoFlag: (p) => (p.yearBuilt !== null && p.yearBuilt < 1978 ? 'Required — built before 1978' : null),
  },
  {
    key: 'knobTubeOil',
    label: 'Knob-and-tube wiring / buried oil tank checked',
    autoFlag: (p) => (p.yearBuilt !== null && p.yearBuilt < 1940 ? 'High priority — built before 1940' : null),
  },
  { key: 'leases', label: 'Actual signed leases obtained and rents verified' },
  { key: 't12', label: 'Trailing-12-month operating actuals obtained' },
  { key: 'inspection', label: 'Professional inspection ordered' },
  { key: 'insuranceQuote', label: 'Insurance quote in hand (not just an estimate)' },
  { key: 'lenderTerms', label: 'Lender term sheet obtained' },
]

export type VerdictLevel = 'PASS' | 'CONDITIONAL' | 'FAIL'

export interface Verdict {
  verdict: VerdictLevel
  reasons: string[]
  summary: string
}

export function computeVerdict(r: DealResult, a: Assumptions, checklistComplete: boolean): Verdict {
  const reasons: string[] = []
  const pct = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(2)}%`)
  const money = (v: number) => `$${Math.round(v).toLocaleString()}`

  const failDscr = r.dscr !== null && r.dscr < a.dscrFailBelow
  const failCashFlow = r.cashFlowBeforeInvestors < 0
  const failCap = r.capRatePct !== null && r.capRatePct < a.capPoorPct
  const hardFail = failDscr || failCashFlow || failCap
  const highUpside = r.rentUpsidePct !== null && r.rentUpsidePct >= a.valueAddUpsidePct

  if (failDscr) reasons.push(`DSCR ${r.dscr!.toFixed(2)} is below the ${a.dscrFailBelow.toFixed(2)} floor — the lender's killer.`)
  if (failCashFlow) reasons.push(`Cash flow before investors is negative (${money(r.cashFlowBeforeInvestors)}/yr).`)
  if (failCap) reasons.push(`Cap rate ${pct(r.capRatePct)} is below the poor threshold of ${a.capPoorPct}%.`)

  let verdict: VerdictLevel
  if (hardFail && !highUpside) {
    verdict = 'FAIL'
  } else if (hardFail && highUpside) {
    verdict = 'CONDITIONAL'
    reasons.push(
      `Rent upside of ${r.rentUpsidePct!.toFixed(1)}% means this only works as a value-add — verify market rents with real comps and negotiate the price down.`,
    )
  } else {
    const marginalDscr = r.dscr !== null && r.dscr < a.dscrPassAt
    const marginalCap = r.capRatePct !== null && r.capRatePct < a.capGoodPct
    if (marginalDscr) reasons.push(`DSCR ${r.dscr!.toFixed(2)} is in the conditional band (${a.dscrFailBelow.toFixed(2)}–${a.dscrPassAt.toFixed(2)}).`)
    if (marginalCap) reasons.push(`Cap rate ${pct(r.capRatePct)} is marginal (below the ${a.capGoodPct}% "good" threshold).`)
    if (marginalDscr || marginalCap) {
      verdict = 'CONDITIONAL'
    } else if (!checklistComplete) {
      verdict = 'CONDITIONAL'
      reasons.push('Metrics clear their thresholds, but the due-diligence checklist is not complete.')
    } else {
      verdict = 'PASS'
      reasons.push('Cap rate, DSCR, and cash flow all clear their thresholds, and due diligence is acknowledged.')
    }
  }

  // Plain-English summary + the single biggest lever
  const parts: string[] = []
  if (verdict === 'FAIL') {
    parts.push('This deal does not pencil at the asking price with your assumptions.')
  } else if (verdict === 'CONDITIONAL') {
    parts.push('This deal is close but does not clearly pencil — it needs either a better price or verified upside.')
  } else {
    parts.push('This deal pencils at the asking price with your assumptions.')
  }
  parts.push(
    `The property produces ${money(r.noi)} of NOI against ${money(r.annualDebtService)} of annual debt service (DSCR ${r.dscr === null ? 'n/a' : r.dscr.toFixed(2)}), leaving ${money(r.cashFlowBeforeInvestors)}/yr before investors.`,
  )
  if (r.rentUpsidePct !== null && r.rentUpsidePct >= a.limitedUpsidePct) {
    parts.push(
      `The biggest lever is market rent versus current rent: rents look ${r.rentUpsidePct.toFixed(0)}% under market, so verifying that with comps (and executing the turnover) is what makes or breaks the deal.`,
    )
  } else if (r.offerCeiling !== null) {
    parts.push(
      `With no meaningful rent upside, the only lever is purchase price — for the deal to pass at your target DSCR and cap rate, the price needs to be at or below ${money(r.offerCeiling)}.`,
    )
  }

  return { verdict, reasons, summary: parts.join(' ') }
}
