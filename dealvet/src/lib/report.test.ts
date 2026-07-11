import { describe, it, expect } from 'vitest'
import { computeDeal, computeVerdict, defaultAssumptions, type PropertyData } from './underwriting'
import { buildArticle, buildPdfHtml, renderArticleHtml, renderArticleMarkdown } from './report'

const property: PropertyData = {
  address: '217 Spruce Street, Manchester, NH 03103',
  price: 690_000,
  yearBuilt: 1900,
  sqft: 4136,
  lotSize: '0.08 acres',
  parkingSpaces: 8,
  heatType: 'hot water baseboard',
  utilitiesPaidBy: 'mixed',
  annualTaxes: 7731,
  listedGrossIncome: 63_600,
  units: [1, 2, 3].map((n) => ({ label: `Unit ${n}`, beds: 3, baths: 1, currentRent: 1750, marketRent: 2300 })),
}

const assumptions = defaultAssumptions(3)
const deal = computeDeal(property, assumptions)
const verdict = computeVerdict(deal, assumptions, false)
const article = buildArticle(property, assumptions, deal, verdict, {})

describe('buildArticle', () => {
  it('carries the verdict and key numbers', () => {
    expect(article.verdict).toBe(verdict.verdict)
    const all = JSON.stringify(article)
    expect(all).toContain('217 Spruce Street')
    expect(all).toContain('$690,000')
    expect(all).toContain('Net operating income')
    expect(all).toContain('DSCR')
  })
  it('does not flag listing income within 5% of actual, but flags a real overstatement', () => {
    expect(JSON.stringify(article)).not.toMatch(/listing claims/i)
    const inflated = buildArticle({ ...property, listedGrossIncome: 75_000 }, assumptions, deal, verdict, {})
    expect(JSON.stringify(inflated)).toMatch(/listing claims/i)
  })
  it('includes the offer ceiling section when NOI is positive', () => {
    expect(article.sections.some((s) => s.heading.includes('Price That Would Work'))).toBe(true)
  })
})

describe('renderers', () => {
  it('markdown has headings, a table, and the disclaimer', () => {
    const md = renderArticleMarkdown(article)
    expect(md).toMatch(/^# Deal Breakdown/m)
    expect(md).toMatch(/^## The Real Operating Statement/m)
    expect(md).toMatch(/\| Line item \| Annual \|/)
    expect(md).toMatch(/not investment advice/i)
  })
  it('html escapes content and closes its tags', () => {
    const html = renderArticleHtml(article)
    expect(html).toContain('<h1>')
    expect(html).toContain('</table>')
    expect(html).not.toContain('<script')
  })
  it('pdf html is a full document with the verdict badge', () => {
    const html = buildPdfHtml(article, 'July 11, 2026')
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain(`class="badge">${verdict.verdict}`)
    expect(html).toContain('July 11, 2026')
  })
})
