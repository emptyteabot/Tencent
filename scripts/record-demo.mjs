import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const outputDir = 'C:/Users/cyh/Downloads/腾讯十万/提交包/video-recording'
const url = process.env.KOC_DEMO_URL || 'http://127.0.0.1:4173'

await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--window-size=1440,900'],
})

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: outputDir,
    size: { width: 1440, height: 900 },
  },
})

const page = await context.newPage()

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

await page.locator('#video-url').fill('https://v.qq.com/x/page/koc-reference-video.html')
await page.waitForTimeout(900)
await page.locator('button[type="submit"]').click()
await page.waitForTimeout(4200)

await page.mouse.wheel(0, 520)
await page.waitForTimeout(9000)
await page.mouse.wheel(0, 560)
await page.waitForTimeout(12000)
await page.mouse.wheel(0, 620)
await page.waitForTimeout(18000)
await page.mouse.wheel(0, -680)
await page.waitForTimeout(12000)
await page.mouse.wheel(0, 760)
await page.waitForTimeout(18000)
await page.mouse.wheel(0, 740)
await page.waitForTimeout(22000)
await page.mouse.wheel(0, -920)
await page.waitForTimeout(24000)
await page.mouse.wheel(0, 920)
await page.waitForTimeout(26000)
await page.mouse.wheel(0, 960)
await page.waitForTimeout(24000)

const video = page.video()
await context.close()
await browser.close()

const videoPath = await video?.path()
if (!videoPath) {
  throw new Error('Playwright did not create a video file')
}

console.log(path.resolve(videoPath))
