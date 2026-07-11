// Report/article builders — pure functions over the computed deal.
// One structured "article model" renders to Markdown (downloads), HTML
// (clipboard for Substack), and a print-styled document (server PDF).

import {
  CHECKLIST_ITEMS,
  type Assumptions,
  type DealResult,
  type PropertyData,
  type Verdict,
} from './underwriting'

const money = (v: number | null | undefined, d = 0): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d, minimumFractionDigits: d })

const pct = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(d)}%`

const num = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d)

export type Block =
  | { type: 'p'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'list'; items: string[] }

export interface Section {
  heading: string
  blocks: Block[]
}

export interface ArticleModel {
  title: string
  subtitle: string
  verdict: Verdict['verdict']
  sections: Section[]
  footer: string
}

const shortAddress = (address: string): string => address.split(',')[0] || address || 'the property'

export function buildArticle(
  p: PropertyData,
  a: Assumptions,
  deal: DealResult,
  verdict: Verdict,
  checklist: Record<string, boolean>,
): ArticleModel {
  const addr = shortAddress(p.address)
  const unitWord = `${deal.unitCount}-unit`
  const perUnit = deal.unitCount > 0 ? money(p.price / deal.unitCount) : '—'

  const titleTail =
    verdict.verdict === 'PASS'
      ? 'This One Pencils'
      : verdict.verdict === 'CONDITIONAL'
        ? 'Close — But Only at the Right Price'
        : 'The Numbers Say Walk'
  const title = `Deal Breakdown: ${addr}, a ${unitWord} at ${money(p.price)} — ${titleTail}`
  const subtitle = `Underwriting a ${unitWord} multifamily${p.address ? ` at ${p.address}` : ''}: the real operating statement, the debt test, and the price that would actually work.`

  const sections: Section[] = []

  // The property
  const propBits: string[] = []
  if (p.yearBuilt) propBits.push(`built in ${p.yearBuilt}`)
  if (p.sqft) propBits.push(`${p.sqft.toLocaleString()} sqft finished`)
  if (p.lotSize) propBits.push(`${p.lotSize} lot`)
  if (p.parkingSpaces) propBits.push(`${p.parkingSpaces} parking spaces`)
  if (p.heatType) propBits.push(`${p.heatType.toLowerCase()} heat`)
  const mix = p.units.map((u) => `${u.beds}bd/${u.baths}ba`).join(', ')
  sections.push({
    heading: 'The Property',
    blocks: [
      {
        type: 'p',
        text: `${addr} is a ${unitWord} (${mix})${propBits.length ? `, ${propBits.join(', ')}` : ''}. Asking price is ${money(p.price)} — ${perUnit} per unit — with annual property taxes of ${money(p.annualTaxes)}.`,
      },
    ],
  })

  // Income story
  const marketSentence =
    deal.monthlyMarketRent > 0
      ? ` My market rent estimate puts the same units at ${money(deal.monthlyMarketRent)}/month — rent upside of ${pct(deal.rentUpsidePct, 1)}.`
      : ' I have not locked in a market rent estimate for these units yet, so no upside is counted in this analysis.'
  const incomeBlocks: Block[] = [
    {
      type: 'p',
      text: `Current rents total ${money(deal.monthlyCurrentRent)}/month (${money(deal.gsrAnnual)}/year), a gross rent multiplier of ${num(deal.grm, 1)} and a gross yield of ${pct(deal.grossYieldPct, 1)}.${marketSentence}`,
    },
  ]
  if (p.listedGrossIncome && deal.gsrAnnual > 0 && p.listedGrossIncome > deal.gsrAnnual * 1.05) {
    incomeBlocks.push({
      type: 'p',
      text: `Worth noting: the listing claims ${money(p.listedGrossIncome)} of gross income, but the actual unit rents only support ${money(deal.gsrAnnual)}. I never underwrite off the listing's income figure — always rebuild it from the rent roll.`,
    })
  }
  sections.push({ heading: 'The Income Story', blocks: incomeBlocks })

  // Operating statement
  sections.push({
    heading: 'The Real Operating Statement',
    blocks: [
      {
        type: 'table',
        header: ['Line item', 'Annual'],
        rows: [
          ['Gross scheduled rent', money(deal.gsrAnnual)],
          [`Vacancy (${a.vacancyPct}%)`, `(${money(deal.vacancyLoss)})`],
          ['Effective gross income', money(deal.egi)],
          ['Property taxes', `(${money(deal.expenses.taxes)})`],
          ['Insurance', `(${money(deal.expenses.insurance)})`],
          ['Water / sewer', `(${money(deal.expenses.waterSewer)})`],
          [`Maintenance (${a.maintenancePctEGI}% EGI)`, `(${money(deal.expenses.maintenance)})`],
          [`Management (${a.managementPctEGI}% EGI)`, `(${money(deal.expenses.management)})`],
          ['CapEx reserve', `(${money(deal.expenses.capex)})`],
          ['Net operating income', money(deal.noi)],
        ],
      },
      {
        type: 'p',
        text: `That NOI puts the cap rate at ${pct(deal.capRatePct)} against the ${money(p.price)} ask (my band: ${a.capGoodPct}%+ is good, under ${a.capPoorPct}% is poor).`,
      },
    ],
  })

  // Debt test
  sections.push({
    heading: 'The Debt Test',
    blocks: [
      {
        type: 'p',
        text: `Assuming ${a.downPaymentPct}% down at ${a.interestRatePct}% over ${a.amortYears} years: a ${money(deal.loanAmount)} loan costs ${money(deal.annualDebtService)}/year in debt service. That makes the DSCR ${num(deal.dscr)} — lenders generally want ${num(a.dscrPassAt)}+ — and leaves ${money(deal.cashFlowBeforeInvestors)}/year in cash flow before anyone else gets paid.`,
      },
      {
        type: 'table',
        header: ['Metric', 'Value', 'Threshold'],
        rows: [
          ['Cap rate', pct(deal.capRatePct), `good ≥ ${a.capGoodPct}%`],
          ['DSCR', num(deal.dscr), `pass ≥ ${num(a.dscrPassAt)}`],
          ['Cash flow before investors', `${money(deal.cashFlowBeforeInvestors)}/yr`, '≥ $0'],
          ['Cash-on-cash', pct(deal.cashOnCashPct, 1), '—'],
          ['Rent upside', pct(deal.rentUpsidePct, 1), `value-add ≥ ${a.valueAddUpsidePct}%`],
        ],
      },
    ],
  })

  // Verdict
  sections.push({
    heading: `The Verdict: ${verdict.verdict}`,
    blocks: [
      { type: 'p', text: verdict.summary },
      { type: 'list', items: verdict.reasons },
    ],
  })

  // Price that works
  if (deal.offerCeiling !== null) {
    sections.push({
      heading: 'The Price That Would Work',
      blocks: [
        {
          type: 'p',
          text: `Holding NOI and loan terms constant, the deal passes at a maximum of ${money(deal.maxPriceForDscr)} for the DSCR test and ${money(deal.maxPriceForCap)} for the cap-rate test. The binding number — my offer ceiling — is ${money(deal.offerCeiling)}${p.price > 0 ? `, ${money(p.price - deal.offerCeiling)} below ask` : ''}.`,
        },
      ],
    })
  }

  // Diligence
  const openItems = CHECKLIST_ITEMS.filter((i) => !checklist[i.key]).map((i) => i.label)
  const diligence: Block[] = []
  if (deal.warnings.length) diligence.push({ type: 'list', items: deal.warnings })
  if (openItems.length)
    diligence.push({
      type: 'p',
      text: `Still open before any offer goes hard: ${openItems.join('; ').toLowerCase()}.`,
    })
  if (diligence.length) sections.push({ heading: 'Due-Diligence Flags', blocks: diligence })

  return {
    title,
    subtitle,
    verdict: verdict.verdict,
    sections,
    footer:
      'Numbers are from listing data plus my stated assumptions, and every figure should be independently verified. This is analysis for educational purposes, not investment advice.',
  }
}

// ---------- Renderers ----------

export function renderArticleMarkdown(m: ArticleModel): string {
  const out: string[] = [`# ${m.title}`, '', `*${m.subtitle}*`, '']
  for (const s of m.sections) {
    out.push(`## ${s.heading}`, '')
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text, '')
      if (b.type === 'list') out.push(...b.items.map((i) => `- ${i}`), '')
      if (b.type === 'table') {
        out.push(`| ${b.header.join(' | ')} |`)
        out.push(`| ${b.header.map(() => '---').join(' | ')} |`)
        out.push(...b.rows.map((r) => `| ${r.join(' | ')} |`), '')
      }
    }
  }
  out.push('---', '', `*${m.footer}*`, '')
  return out.join('\n')
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** HTML fragment for the clipboard — pastes cleanly into Substack's editor. */
export function renderArticleHtml(m: ArticleModel): string {
  const out: string[] = [`<h1>${esc(m.title)}</h1>`, `<p><em>${esc(m.subtitle)}</em></p>`]
  for (const s of m.sections) {
    out.push(`<h2>${esc(s.heading)}</h2>`)
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(`<p>${esc(b.text)}</p>`)
      if (b.type === 'list') out.push(`<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)
      if (b.type === 'table') {
        out.push(
          `<table><thead><tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        )
      }
    }
  }
  out.push(`<hr/><p><em>${esc(m.footer)}</em></p>`)
  return out.join('\n')
}

/** Full print-styled document for the server-side PDF. */
export function buildPdfHtml(m: ArticleModel, generatedOn: string): string {
  const badge =
    m.verdict === 'PASS' ? '#059669' : m.verdict === 'CONDITIONAL' ? '#d97706' : '#dc2626'
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font: 11pt/1.55 -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1e293b; margin: 0; }
  header { border-bottom: 3px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px; }
  .brand { font-size: 9pt; font-weight: 700; letter-spacing: 0.12em; color: #4f46e5; text-transform: uppercase; }
  h1 { font-size: 17pt; margin: 6px 0 4px; }
  .sub { color: #64748b; font-size: 10pt; }
  .badge { display: inline-block; margin-top: 10px; padding: 4px 14px; border-radius: 999px; color: #fff; font-weight: 800; font-size: 11pt; background: ${badge}; }
  h2 { font-size: 12.5pt; margin: 18px 0 6px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  p { margin: 6px 0; }
  ul { margin: 6px 0; padding-left: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 9px; text-align: left; }
  th { background: #f1f5f9; font-weight: 700; }
  tr:last-child td { font-weight: 700; }
  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 8.5pt; font-style: italic; }
</style></head><body>
<header>
  <div class="brand">DealVet · Underwriting Report · ${esc(generatedOn)}</div>
  <h1>${esc(m.title)}</h1>
  <div class="sub">${esc(m.subtitle)}</div>
  <span class="badge">${m.verdict}</span>
</header>
${m.sections
  .map(
    (s) =>
      `<h2>${esc(s.heading)}</h2>` +
      s.blocks
        .map((b) => {
          if (b.type === 'p') return `<p>${esc(b.text)}</p>`
          if (b.type === 'list') return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
          return `<table><thead><tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        })
        .join(''),
  )
  .join('')}
<footer>${esc(m.footer)}</footer>
</body></html>`
}
