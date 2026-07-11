// One-time converter: HUD FMR county-level XLSX -> compact JSON bundled with the app.
// Refresh yearly: download the latest FY file from
//   https://www.huduser.gov/portal/datasets/fmr.html  (e.g. FY26_FMRs_revised.xlsx)
// then run:  node scripts/build-fmr-data.mjs <path-to-xlsx> <fiscal-year-label>

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const [, , xlsxPath, yearLabel] = process.argv
if (!xlsxPath || !yearLabel) {
  console.error('usage: node scripts/build-fmr-data.mjs <FMRs.xlsx> <year label, e.g. FY2026>')
  process.exit(1)
}

const wb = XLSX.readFile(xlsxPath)
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])

// Entry: [state, place name, HUD area name, fmr0, fmr1, fmr2, fmr3, fmr4]
const entries = []
for (const r of rows) {
  const st = r.stusps
  const name = String(r.county_town_name || r.countyname || '').trim()
  const area = String(r.hud_area_name || '').trim()
  const fmrs = [r.fmr_0, r.fmr_1, r.fmr_2, r.fmr_3, r.fmr_4].map(Number)
  if (!st || !name || fmrs.some((n) => !Number.isFinite(n) || n <= 0)) continue
  entries.push([st, name, area, ...fmrs])
}

const out = { year: yearLabel, source: 'HUD Fair Market Rents (huduser.gov)', entries }
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/fmr.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`wrote ${entries.length} entries -> ${dest} (${Math.round(fs.statSync(dest).size / 1024)} KB)`)
