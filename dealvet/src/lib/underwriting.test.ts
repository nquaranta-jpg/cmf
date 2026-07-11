import { describe, it, expect } from 'vitest'
import {
  monthlyPayment,
  computeDeal,
  computeVerdict,
  defaultAssumptions,
  type PropertyData,
  type UnitInfo,
} from './underwriting'

const unit = (currentRent: number, marketRent = currentRent): UnitInfo => ({
  label: 'Unit',
  beds: 2,
  baths: 1,
  currentRent,
  marketRent,
})

function fixtureProperty(overrides: Partial<PropertyData> = {}): PropertyData {
  return {
    address: '123 Test St',
    price: 700_000,
    yearBuilt: 1965,
    sqft: 4000,
    lotSize: '0.25 acres',
    parkingSpaces: 4,
    heatType: 'forced air gas',
    utilitiesPaidBy: 'tenant',
    annualTaxes: 8400,
    listedGrossIncome: null,
    units: [unit(1500), unit(1500), unit(1500), unit(1500)],
    ...overrides,
  }
}

describe('monthlyPayment', () => {
  it('matches the standard amortization formula ($300k, 6%, 30yr → $1,798.65)', () => {
    expect(monthlyPayment(300_000, 6, 30)).toBeCloseTo(1798.65, 1)
  })
  it('handles zero interest as straight-line principal', () => {
    expect(monthlyPayment(120_000, 0, 10)).toBeCloseTo(1000, 6)
  })
  it('returns 0 for a zero or negative principal', () => {
    expect(monthlyPayment(0, 6, 30)).toBe(0)
    expect(monthlyPayment(-5, 6, 30)).toBe(0)
  })
})

describe('computeDeal — operating statement (Stage 2)', () => {
  const a = {
    ...defaultAssumptions(4),
    insuranceAnnual: 4800,
    waterSewerAnnual: 2000,
  }
  const r = computeDeal(fixtureProperty(), a)

  it('builds GSR from unit rents', () => {
    expect(r.gsrAnnual).toBe(72_000)
  })
  it('applies vacancy to get EGI', () => {
    expect(r.vacancyLoss).toBeCloseTo(4320, 2)
    expect(r.egi).toBeCloseTo(67_680, 2)
  })
  it('computes each expense line and NOI', () => {
    expect(r.expenses.maintenance).toBeCloseTo(6768, 2) // 10% of EGI
    expect(r.expenses.management).toBeCloseTo(6091.2, 2) // 9% of EGI
    expect(r.expenses.capex).toBe(1200) // $300 × 4 units
    expect(r.expenses.total).toBeCloseTo(8400 + 4800 + 2000 + 6768 + 6091.2 + 1200, 2)
    expect(r.noi).toBeCloseTo(38_420.8, 1)
  })
})

describe('computeDeal — cap rate and DSCR (Stages 3–4)', () => {
  const a = { ...defaultAssumptions(4), insuranceAnnual: 4800, waterSewerAnnual: 2000 }
  const r = computeDeal(fixtureProperty(), a)

  it('cap rate = NOI / price', () => {
    expect(r.capRatePct).toBeCloseTo((38_420.8 / 700_000) * 100, 2)
    expect(r.capBand).toBe('marginal') // ~5.49% sits between 5 and 6.5
  })
  it('loan, debt service, and DSCR', () => {
    expect(r.loanAmount).toBe(525_000)
    expect(r.monthlyDebtPayment).toBeCloseTo(3318.36, 0)
    expect(r.dscr!).toBeCloseTo(38_420.8 / (r.monthlyDebtPayment * 12), 4)
    expect(r.dscrBand).toBe('fail') // ≈0.96
    expect(r.cashFlowBeforeInvestors).toBeLessThan(0)
  })
})

describe('computeDeal — solve for price (Stage 6 helper)', () => {
  it('recomputing at maxPriceForDscr yields DSCR ≈ the pass target', () => {
    const a = { ...defaultAssumptions(4), insuranceAnnual: 4800, waterSewerAnnual: 2000 }
    const first = computeDeal(fixtureProperty(), a)
    const second = computeDeal(fixtureProperty({ price: first.maxPriceForDscr! }), a)
    expect(second.dscr!).toBeCloseTo(a.dscrPassAt, 4)
  })
  it('recomputing at maxPriceForCap yields cap ≈ the good threshold', () => {
    const a = { ...defaultAssumptions(4), insuranceAnnual: 4800, waterSewerAnnual: 2000 }
    const first = computeDeal(fixtureProperty(), a)
    const second = computeDeal(fixtureProperty({ price: first.maxPriceForCap! }), a)
    expect(second.capRatePct!).toBeCloseTo(a.capGoodPct, 4)
  })
})

describe('computeDeal — degenerate inputs never produce NaN', () => {
  it('blank property returns nulls, not NaN', () => {
    const p = fixtureProperty({ price: 0, units: [], annualTaxes: 0 })
    const r = computeDeal(p, defaultAssumptions(0))
    expect(r.grm).toBeNull()
    expect(r.capRatePct).toBeNull()
    expect(r.dscr).toBeNull()
    expect(Number.isNaN(r.noi)).toBe(false)
  })
})

describe('computeVerdict (Stage 6)', () => {
  const a = { ...defaultAssumptions(4), insuranceAnnual: 4800, waterSewerAnnual: 2000 }

  it('FAILs when DSCR is below the floor with no rent upside', () => {
    const r = computeDeal(fixtureProperty(), a)
    expect(computeVerdict(r, a, true).verdict).toBe('FAIL')
  })

  it('is CONDITIONAL when metrics fail but rent upside is high (value-add override)', () => {
    const p = fixtureProperty({ units: [unit(1500, 1900), unit(1500, 1900), unit(1500, 1900), unit(1500, 1900)] })
    const r = computeDeal(p, a)
    const v = computeVerdict(r, a, true)
    expect(v.verdict).toBe('CONDITIONAL')
    expect(v.reasons.join(' ')).toMatch(/value-add/i)
  })

  it('PASSes a cheap enough deal with the checklist complete', () => {
    const p = fixtureProperty({ price: 450_000 })
    const r = computeDeal(p, a)
    expect(r.dscr!).toBeGreaterThanOrEqual(a.dscrPassAt)
    expect(r.capRatePct!).toBeGreaterThanOrEqual(a.capGoodPct)
    expect(computeVerdict(r, a, true).verdict).toBe('PASS')
  })

  it('caps at CONDITIONAL when metrics pass but the checklist is incomplete', () => {
    const p = fixtureProperty({ price: 450_000 })
    const r = computeDeal(p, a)
    expect(computeVerdict(r, a, false).verdict).toBe('CONDITIONAL')
  })
})

describe('warnings (Stage 5 auto-flags)', () => {
  it('flags lead paint, old wiring, owner-paid heat, and overstated listing income', () => {
    const p = fixtureProperty({
      yearBuilt: 1925,
      heatType: 'hot water baseboard',
      utilitiesPaidBy: 'owner',
      listedGrossIncome: 90_000,
    })
    const r = computeDeal(p, defaultAssumptions(4))
    const all = r.warnings.join(' | ')
    expect(all).toMatch(/lead paint/i)
    expect(all).toMatch(/knob-and-tube/i)
    expect(all).toMatch(/who pays heat/i)
    expect(all).toMatch(/overstated/i)
  })
})
