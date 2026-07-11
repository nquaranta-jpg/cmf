import * as cheerio from 'cheerio'
import type { Page } from 'puppeteer'
import { getBrowser } from './browser'

// Best-effort listing extractor, two passes:
//   1. Plain fetch + cheerio (fast) — JSON-LD, meta tags, loose text patterns.
//   2. If that comes back thin (JS-rendered pages like MLS collab links), render the
//      page in headless Chrome and parse the rendered text, including MLS-style
//      label/value pairs ("Tax Annual Amount" / "$7,731", "Unit 1 Rental Amount", …).
// Everything returned is UNVERIFIED — the client makes the user confirm each field.

export interface ScrapedUnit {
  beds?: number
  baths?: number
  currentRent?: number
}

export interface ScrapedFields {
  address?: string
  price?: number
  unitCount?: number
  yearBuilt?: number
  sqft?: number
  annualTaxes?: number
  listedGrossIncome?: number
  heatType?: string
  lotSize?: string
  parkingSpaces?: number
  units?: ScrapedUnit[]
}

export interface ScrapeResult {
  ok: boolean
  fields: ScrapedFields
  /** Which form fields were extracted (client uses these for unverified markers) */
  found: string[]
  note: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const parseNum = (s: string | undefined | null): number | undefined => {
  if (!s) return undefined
  const n = Number(String(s).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function fromJsonLd($: cheerio.CheerioAPI, fields: ScrapedFields): void {
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text())
      const nodes = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data]
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue
        const addr = node.address
        if (addr && !fields.address) {
          fields.address =
            typeof addr === 'string'
              ? addr
              : [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(', ')
        }
        const price = node.offers?.price ?? node.price
        if (price && !fields.price) fields.price = parseNum(String(price))
        const size = node.floorSize?.value
        if (size && !fields.sqft) fields.sqft = parseNum(String(size))
        if (node.yearBuilt && !fields.yearBuilt) fields.yearBuilt = parseNum(String(node.yearBuilt))
        if (node.numberOfUnits && !fields.unitCount) fields.unitCount = parseNum(String(node.numberOfUnits))
      }
    } catch {
      /* malformed JSON-LD — ignore */
    }
  })
}

/**
 * Loose single-string text patterns (works on both raw and rendered text).
 * Also handles MLS label/value pairs flattened onto one line — pasting into a
 * single-line input strips newlines, so labels and values end up space-joined.
 */
function fromText(text: string, fields: ScrapedFields): void {
  const ensureUnit = (n: number): ScrapedUnit => {
    fields.units ??= []
    while (fields.units.length < n) fields.units.push({})
    return fields.units[n - 1]
  }
  if (fields.unitCount === undefined) {
    const m = text.match(/total units\s*:?\s*(\d{1,2})\b/i)
    if (m) fields.unitCount = parseNum(m[1])
  }
  for (const m of text.matchAll(/unit\s*(\d{1,2})\s*rental amount[^$\d]{0,20}\$\s?([\d,]+(?:\.\d{2})?)/gi)) {
    ensureUnit(Number(m[1])).currentRent ??= parseNum(m[2])
  }
  for (const m of text.matchAll(/unit\s*(\d{1,2})\s*baths?\s*:?\s*([\d.]+)/gi)) {
    ensureUnit(Number(m[1])).baths ??= parseNum(m[2])
  }
  if (!fields.heatType) {
    const m = text.match(/heating\s*:?\s*([A-Za-z][A-Za-z ,/-]{2,40}?)\s*(?:cooling|water source|electric|sewer|lot size|$)/i)
    if (m) fields.heatType = m[1].trim()
  }
  if (!fields.address) {
    const m = text.match(
      /\b(\d{1,6}\s+[A-Za-z0-9'. -]{2,40}?\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|place|pl|blvd|boulevard|terrace|ter|circle|cir|square|sq)\.?),?\s+([A-Za-z'. -]+?,?\s+[A-Z]{2}\s+\d{5})\b/i,
    )
    if (m) fields.address = `${m[1]}, ${m[2]}`
  }
  if (!fields.lotSize) {
    const m = text.match(/lot size acres\s*:?\s*([\d.]+)/i)
    if (m) fields.lotSize = `${m[1]} acres`
  }
  if (fields.sqft === undefined) {
    const m = text.match(/(?:total finished area|agfinarea)\s*:?\s*([\d,]+)/i)
    if (m) fields.sqft = parseNum(m[1])
  }
  if (fields.price === undefined) {
    // First $ amount that plausibly reads as a price (≥ $50k), skipping amounts
    // whose surrounding context says tax/income/rent/loan.
    for (const m of text.matchAll(/\$\s?([\d]{1,3}(?:,\d{3}){1,3})(?!\d)/g)) {
      const n = parseNum(m[1])
      if (!n || n < 50_000) continue
      const context = text.slice(Math.max(0, (m.index ?? 0) - 45), m.index).toLowerCase()
      if (/tax|income|rent|loan|payment|assess/.test(context)) continue
      fields.price = n
      break
    }
  }
  if (fields.yearBuilt === undefined) {
    const m = text.match(/(?:built|year built|constructed)[^\d]{0,15}((?:18|19|20)\d{2})/i)
    if (m) fields.yearBuilt = parseNum(m[1])
  }
  if (fields.unitCount === undefined) {
    const m = text.match(/(\d{1,2})[\s-]*(?:unit|family|plex)/i)
    const n = m ? parseNum(m[1]) : undefined
    if (n && n >= 2 && n <= 60) fields.unitCount = n
  }
  if (fields.sqft === undefined) {
    const m = text.match(/([\d]{1,2},?\d{3})\s*(?:sq\.?\s?ft|square\s+feet|sf)\b/i)
    if (m) fields.sqft = parseNum(m[1])
  }
  if (fields.annualTaxes === undefined) {
    const m = text.match(/tax(?:es)?[^$\n]{0,40}\$\s?([\d,]+)/i)
    if (m) fields.annualTaxes = parseNum(m[1])
  }
  if (fields.listedGrossIncome === undefined) {
    const m = text.match(/gross\s+(?:annual\s+)?income[^$\n]{0,30}\$\s?([\d,]+)/i)
    if (m) fields.listedGrossIncome = parseNum(m[1])
  }
  if (fields.parkingSpaces === undefined) {
    const m = text.match(/(\d{1,2})\s+(?:off[- ]street\s+)?parking spaces/i)
    if (m) fields.parkingSpaces = parseNum(m[1])
  }
  // "Each unit features 3 bedrooms" — common in remarks; applies to every unit
  const bedsM = text.match(/each unit (?:features|has|offers|includes)\s+(\d)\s+bed/i)
  if (bedsM && fields.units) {
    const beds = Number(bedsM[1])
    for (const u of fields.units) if (u.beds === undefined) u.beds = beds
  }
}

/**
 * MLS-style label/value pairs from rendered text, where the value sits on the
 * same line after the label or on the next line ("Tax Annual Amount\n$7,731.00").
 */
function fromLines(lines: string[], fields: ScrapedFields): void {
  const valueAfter = (i: number, label: string): string | undefined => {
    const rest = lines[i].slice(label.length).trim()
    return rest || lines[i + 1]
  }
  const ensureUnit = (n: number): ScrapedUnit => {
    fields.units ??= []
    while (fields.units.length < n) fields.units.push({})
    return fields.units[n - 1]
  }

  lines.forEach((line, i) => {
    const tests: [RegExp, (m: RegExpMatchArray, v: string | undefined) => void][] = [
      [/^(tax annual amount|annual tax(?:es)? amount|annual taxes)\b/i, (m, v) => { fields.annualTaxes ??= parseNum(v) }],
      [/^year built\b/i, (m, v) => { fields.yearBuilt ??= parseNum(v) }],
      [/^total units\b/i, (m, v) => { fields.unitCount ??= parseNum(v) }],
      [/^gross (?:annual )?income\b/i, (m, v) => { fields.listedGrossIncome ??= parseNum(v) }],
      [/^(total finished area|agfinarea|finished area|total sqft|square footage)\b/i, (m, v) => { fields.sqft ??= parseNum(v) }],
      [/^heating\b/i, (m, v) => { if (!fields.heatType && v && v.length < 60) fields.heatType = v }],
      [/^lot size acres\b/i, (m, v) => { if (!fields.lotSize && v) fields.lotSize = `${v} acres` }],
      [/^unit\s*(\d{1,2})\s*rental amount\b/i, (m, v) => { ensureUnit(Number(m[1])).currentRent ??= parseNum(v) }],
      [/^unit\s*(\d{1,2})\s*baths?\b/i, (m, v) => { ensureUnit(Number(m[1])).baths ??= parseNum(v) }],
      [/^unit\s*(\d{1,2})\s*(?:beds?|bedrooms?)\b/i, (m, v) => { ensureUnit(Number(m[1])).beds ??= parseNum(v) }],
      [/^list price\b/i, (m, v) => { fields.price ??= parseNum(v) }],
    ]
    for (const [re, apply] of tests) {
      const m = line.match(re)
      if (m) apply(m, valueAfter(i, m[0]))
    }
  })
}

/** "217 Spruce Street" on one line, "Manchester, NH 03103" on the next. */
function addressFromLines(lines: string[], fields: ScrapedFields): void {
  if (fields.address) return
  const street =
    /^\d{1,6}\s+[A-Za-z0-9'. -]+\b(street|st|ave|avenue|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|blvd|boulevard|ter|terrace|cir|circle|sq|square|hwy|highway)\.?$/i
  const cityStZip = /^[A-Za-z'. -]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/
  for (let i = 0; i < lines.length - 1; i++) {
    if (street.test(lines[i]) && cityStZip.test(lines[i + 1])) {
      fields.address = `${lines[i]}, ${lines[i + 1]}`
      return
    }
  }
}

function extractFromHtml(html: string, fields: ScrapedFields): void {
  const $ = cheerio.load(html)
  fromJsonLd($, fields)
  if (!fields.address) {
    const og = $('meta[property="og:title"]').attr('content') ?? $('title').first().text()
    const m = og?.match(/\d+[^,|–-]+,[^,|–-]+(?:,\s*[A-Z]{2})?/)
    if (m) fields.address = m[0].trim()
  }
  $('script, style, noscript').remove()
  const rawText = $('body').text()
  const lines = rawText.split('\n').map((s) => s.trim()).filter(Boolean)
  fromLines(lines, fields)
  addressFromLines(lines, fields)
  fromText(rawText.replace(/\s+/g, ' '), fields)
}

const FORM_KEYS: (keyof ScrapedFields)[] = [
  'address', 'price', 'unitCount', 'yearBuilt', 'sqft', 'annualTaxes',
  'listedGrossIncome', 'heatType', 'lotSize', 'parkingSpaces',
]

function foundKeys(fields: ScrapedFields): string[] {
  const found = FORM_KEYS.filter((k) => fields[k] !== undefined) as string[]
  if (fields.units?.length && !found.includes('unitCount')) found.push('unitCount')
  return found
}

function countFound(fields: ScrapedFields): number {
  return foundKeys(fields).length + (fields.units?.some((u) => u.currentRent) ? 1 : 0)
}

/**
 * Parse raw listing-page text the user copied from their own browser.
 * Bot-protected sites (MLS portals behind Cloudflare) block datacenter IPs,
 * so in the cloud this is the reliable path: same parsers, zero fetching.
 */
export function parseListingText(text: string): ScrapeResult {
  const fields: ScrapedFields = {}
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  fromLines(lines, fields)
  addressFromLines(lines, fields)
  fromText(text.replace(/\s+/g, ' '), fields)
  const found = foundKeys(fields)
  const rentCount = fields.units?.filter((u) => u.currentRent).length ?? 0
  if (found.length === 0) {
    return { ok: false, fields: {}, found: [], note: 'Nothing recognizable in that text — enter the details manually.' }
  }
  return {
    ok: true,
    fields,
    found,
    note: `Extracted ${found.length} field(s)${rentCount ? ` including ${rentCount} unit rent(s)` : ''} from the pasted text — all unverified. Confirm or correct each one.`,
  }
}

// ---------- Pass 1: plain fetch ----------

async function quickScrape(url: string): Promise<ScrapedFields> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const fields: ScrapedFields = {}
  extractFromHtml(await res.text(), fields)
  return fields
}

// ---------- Pass 2: headless Chrome ----------

async function extractFromPage(page: Page): Promise<ScrapedFields> {
  const { html, text } = await page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    text: document.body?.innerText ?? '',
  }))
  const fields: ScrapedFields = {}
  const lines = text.split('\n').map((s: string) => s.trim()).filter(Boolean)
  fromLines(lines, fields)
  addressFromLines(lines, fields)
  const $ = cheerio.load(html)
  fromJsonLd($, fields)
  fromText(text.replace(/\s+/g, ' '), fields)
  return fields
}

async function browserScrape(url: string): Promise<ScrapedFields> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(UA)
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 }).catch(() => {
      /* slow pages: parse whatever has rendered */
    })

    // SPAs keep hydrating well after network-idle, so poll instead of a single
    // extract. Search-results pages (e.g. some MLS collab links) additionally
    // need a click into the listing card, so try that once mid-loop.
    const fields: ScrapedFields = {}
    const hasMoneyFields = () =>
      fields.annualTaxes !== undefined || fields.yearBuilt !== undefined || fields.units?.some((u) => u.currentRent)
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(1500)
      const pass = await extractFromPage(page)
      for (const [k, v] of Object.entries(pass)) {
        if (v !== undefined) (fields as Record<string, unknown>)[k] = v
      }
      if (hasMoneyFields()) break
      if (attempt === 2) {
        await page.evaluate(() => {
          const link = [...document.querySelectorAll('a')].find((a) => a.querySelector('img'))
          if (link) (link as HTMLElement).click()
        })
      }
    }
    return fields
  } finally {
    await page.close()
  }
}

// ---------- Entry point ----------

export async function scrapeListing(url: string): Promise<ScrapeResult> {
  let fields: ScrapedFields = {}
  let quickError: string | null = null
  try {
    fields = await quickScrape(url)
  } catch (err) {
    quickError = err instanceof Error ? err.message : String(err)
  }

  // Thin result (or blocked fetch) → the page is likely JS-rendered; use a real browser.
  if (countFound(fields) < 4) {
    try {
      const rendered = await browserScrape(url)
      for (const [k, v] of Object.entries(rendered)) {
        if (v !== undefined) (fields as Record<string, unknown>)[k] = v
      }
    } catch (err) {
      if (countFound(fields) === 0) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          fields: {},
          found: [],
          note: `Could not read that page (${quickError ?? msg}) — enter the details manually.`,
        }
      }
    }
  }

  const found = foundKeys(fields)
  const rentCount = fields.units?.filter((u) => u.currentRent).length ?? 0
  if (found.length === 0) {
    return { ok: false, fields: {}, found: [], note: 'Nothing could be extracted from that page — enter the details manually.' }
  }
  return {
    ok: true,
    fields,
    found,
    note: `Extracted ${found.length} field(s)${rentCount ? ` including ${rentCount} unit rent(s)` : ''} — all unverified. Confirm or correct each one.`,
  }
}
