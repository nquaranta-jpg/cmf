import path from 'node:path'
import express from 'express'
import { getBrowser } from './browser'
import { parseListingText, scrapeListing } from './scrape'
import { deleteAnalysis, getAnalysis, listAnalyses, saveAnalysis, type AnalysisRecord } from './store'
import {
  CHECKLIST_ITEMS,
  computeDeal,
  computeVerdict,
  type Assumptions,
  type PropertyData,
} from '../src/lib/underwriting'
import { buildArticle, buildPdfHtml } from '../src/lib/report'

const app = express()
app.use(express.json({ limit: '1mb' }))

app.post('/api/scrape', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ ok: false, fields: {}, found: [], note: 'Enter a full http(s) listing URL.' })
    return
  }
  res.json(await scrapeListing(url))
})

app.post('/api/parse-text', (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  if (text.trim().length < 20) {
    res.status(400).json({ ok: false, fields: {}, found: [], note: 'Paste the full listing page text (select-all, copy).' })
    return
  }
  res.json(parseListingText(text.slice(0, 500_000)))
})

app.get('/api/analyses', (_req, res) => {
  res.json(listAnalyses())
})

app.get('/api/analyses/:id', (req, res) => {
  const rec = getAnalysis(req.params.id)
  if (!rec) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json(rec)
})

app.post('/api/analyses', (req, res) => {
  const rec = req.body as AnalysisRecord
  if (!rec?.id || !rec?.name) {
    res.status(400).json({ error: 'id and name are required' })
    return
  }
  res.json(saveAnalysis(rec))
})

app.delete('/api/analyses/:id', (req, res) => {
  deleteAnalysis(req.params.id)
  res.json({ ok: true })
})

app.post('/api/report/pdf', async (req, res) => {
  const { property, assumptions, checklist } = req.body as {
    property: PropertyData
    assumptions: Assumptions
    checklist: Record<string, boolean>
  }
  if (!property || !assumptions) {
    res.status(400).json({ error: 'property and assumptions are required' })
    return
  }
  try {
    const deal = computeDeal(property, assumptions)
    const checklistComplete = CHECKLIST_ITEMS.every((i) => checklist?.[i.key])
    const verdict = computeVerdict(deal, assumptions, checklistComplete)
    const article = buildArticle(property, assumptions, deal, verdict, checklist ?? {})
    const html = buildPdfHtml(article, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))

    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'load' })
      const pdf = await page.pdf({
        format: 'letter',
        printBackground: true,
        margin: { top: '0.6in', bottom: '0.6in', left: '0.65in', right: '0.65in' },
      })
      const slug = (property.address.split(',')[0] || 'dealvet-report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      res.setHeader('content-type', 'application/pdf')
      res.setHeader('content-disposition', `attachment; filename="dealvet-${slug}.pdf"`)
      res.send(Buffer.from(pdf))
    } finally {
      await page.close()
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// In production the same process serves the built frontend (vite build → dist/).
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(process.cwd(), 'dist')
  app.use(express.static(dist))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

// Respect the platform's PORT only in production — in dev the harness may set
// PORT to the Vite port, and the API must stay on 3001 (vite proxies to it).
const PORT = process.env.NODE_ENV === 'production' ? Number(process.env.PORT ?? 3001) : 3001
app.listen(PORT, () => console.log(`DealVet listening on http://localhost:${PORT}`))
