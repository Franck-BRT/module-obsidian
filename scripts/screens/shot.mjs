// Photographs each screen asked, in each theme and width: node shot.mjs reserves:light:1280 budget:dark:390 …
import { createRequire } from 'module'
const require = createRequire('/opt/node22/lib/node_modules/')
const { chromium } = require('playwright')
const dir = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const spec of process.argv.slice(2)) {
  const [screen, theme = 'light', width = '1280', height = '900', lang = 'fr'] = spec.split(':')
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 })
  page.on('console', (msg) => {
    const text = msg.text()
    if (/PAGEERROR|MISSING|Error|error/.test(text)) console.log(`[${spec}] ${text.slice(0, 600)}`)
  })
  page.on('pageerror', (error) => console.log(`[${spec}] PAGEERROR ${error.message}`))
  await page.goto(`file://${dir}page.html?screen=${screen}&theme=${theme}&lang=${lang}`)
  await page.waitForSelector('body[data-ready]', { timeout: 20000 }).catch(() => console.log(`[${spec}] timeout`))
  await page.waitForTimeout(150)
  const file = `${dir}shots/${screen}-${theme}-${width}${lang === 'fr' ? '' : '-' + lang}.png`
  await page.screenshot({ path: file, fullPage: true })
  // Anything wider than the window: a page that scrolls sideways on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 2) console.log(`[${spec}] OVERFLOW ${overflow}px`)
  console.log('shot', file)
  await page.close()
}
await browser.close()
