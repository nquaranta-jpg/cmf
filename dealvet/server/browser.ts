import puppeteer, { type Browser } from 'puppeteer'

// One shared headless Chrome for scraping and PDF rendering.
let browserPromise: Promise<Browser> | null = null

export function getBrowser(): Promise<Browser> {
  // In the Docker image PUPPETEER_EXECUTABLE_PATH points at Debian's chromium;
  // locally it's unset and puppeteer uses its own downloaded Chrome.
  // --no-sandbox is required when Chrome runs as root in a container.
  browserPromise ??= puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  return browserPromise
}
