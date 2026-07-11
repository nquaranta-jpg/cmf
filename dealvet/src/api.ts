import type { Assumptions, PropertyData } from './lib/underwriting'

export interface ScrapeResponse {
  ok: boolean
  fields: {
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
    units?: { beds?: number; baths?: number; currentRent?: number }[]
  }
  found: string[]
  note: string
}

export interface AnalysisRecord {
  id: string
  name: string
  createdAt: string
  verdict: string
  address: string
  price: number
  property: PropertyData
  assumptions: Assumptions
  checklist: Record<string, boolean>
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json() as Promise<T>
}

export const scrapeUrl = (url: string): Promise<ScrapeResponse> =>
  fetch('/api/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  }).then((r) => json<ScrapeResponse>(r))

// Free-tier hosts (Render/Railway/Fly) have ephemeral disks — the server's JSON
// store can be wiped on redeploys. The browser keeps a localStorage mirror of
// every save and silently re-uploads anything the server has lost.
const MIRROR_KEY = 'dealvet-analyses-mirror'

function readMirror(): Record<string, AnalysisRecord> {
  try {
    return JSON.parse(localStorage.getItem(MIRROR_KEY) ?? '{}') as Record<string, AnalysisRecord>
  } catch {
    return {}
  }
}

function writeMirror(m: Record<string, AnalysisRecord>): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(m))
  } catch {
    /* storage full or unavailable — mirror is best-effort */
  }
}

export const saveAnalysis = (rec: AnalysisRecord): Promise<AnalysisRecord> => {
  const m = readMirror()
  m[rec.id] = rec
  writeMirror(m)
  return fetch('/api/analyses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rec),
  }).then((r) => json(r))
}

export const listAnalyses = async (): Promise<AnalysisRecord[]> => {
  const server = await fetch('/api/analyses').then((r) => json<AnalysisRecord[]>(r))
  const serverIds = new Set(server.map((r) => r.id))
  const missing = Object.values(readMirror()).filter((r) => !serverIds.has(r.id))
  for (const rec of missing) {
    await saveAnalysis(rec).catch(() => {})
  }
  return [...server, ...missing].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const deleteAnalysis = (id: string): Promise<void> => {
  const m = readMirror()
  delete m[id]
  writeMirror(m)
  return fetch(`/api/analyses/${id}`, { method: 'DELETE' }).then(() => undefined)
}
