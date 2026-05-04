import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const outputDir = 'C:/Users/cyh/Downloads/腾讯十万/koc-engine-vercel/submission/video-recording'
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
await page.waitForTimeout(4500)

await page.locator('#video-url').fill('https://v.qq.com/x/page/campus-sunscreen-case.html?title=%E5%86%9B%E8%AE%AD%E9%98%B2%E6%99%92%E5%96%B7%E9%9B%BE%E5%AE%9E%E6%8B%8D%E5%AF%B9%E6%AF%94&desc=%E4%B8%89%E5%A4%A9%E5%AE%9E%E6%B5%8B%20%E8%BD%BB%E8%96%84%E4%B8%8D%E6%90%93%E6%B3%A5%20%E5%B7%A6%E4%B8%8B%E8%A7%92%E9%A2%86%E5%8F%96%E6%B8%85%E5%8D%95')
await page.waitForTimeout(1500)
await page.locator('button[type="submit"]').click()
await page.waitForTimeout(8500)

await page.mouse.wheel(0, 430)
await page.waitForTimeout(22000)
await page.mouse.wheel(0, 470)
await page.waitForTimeout(26000)
await page.mouse.wheel(0, 520)
await page.waitForTimeout(28000)
await page.mouse.wheel(0, 540)
await page.waitForTimeout(30000)
await page.mouse.wheel(0, -420)
await page.waitForTimeout(16000)
await page.mouse.wheel(0, 620)
await page.waitForTimeout(26000)
await page.mouse.wheel(0, 560)
await page.waitForTimeout(24000)

const video = page.video()
await context.close()
await browser.close()

const videoPath = await video?.path()
if (!videoPath) {
  throw new Error('Playwright did not create a video file')
}

console.log(path.resolve(videoPath))
