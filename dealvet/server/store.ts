import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')
const FILE = path.join(DATA_DIR, 'analyses.json')

export interface AnalysisRecord {
  id: string
  name: string
  createdAt: string
  verdict: string
  address: string
  price: number
  property: unknown
  assumptions: unknown
  checklist: Record<string, boolean>
}

function readAll(): AnalysisRecord[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as AnalysisRecord[]
  } catch {
    return []
  }
}

function writeAll(list: AnalysisRecord[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
}

export function listAnalyses(): AnalysisRecord[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getAnalysis(id: string): AnalysisRecord | null {
  return readAll().find((r) => r.id === id) ?? null
}

export function saveAnalysis(rec: AnalysisRecord): AnalysisRecord {
  const list = readAll().filter((r) => r.id !== rec.id)
  list.push(rec)
  writeAll(list)
  return rec
}

export function deleteAnalysis(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id))
}
