process.setMaxListeners(30);
const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

const launchOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        '--no-zygote',
        '--disable-blink-features=AutomationControlled'
    ]
};

// --- ADAPTIVE RESOLVER ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        
        // ADAPTIVE STEP 1: Rotate User-Agents
        // Some sites like 3RSTV often respond better to Mobile headers
        const isMobileRequest = targetUrl.includes('3RSTV');
        const context = await browser.newContext({
            userAgent: isMobileRequest 
                ? 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
                : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            viewport: isMobileRequest ? { width: 360, height: 800 } : { width: 1280, height: 720 }
        });

        const page = await context.newPage();
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        let result = { 
            videoUrl: null, 
            licenseUrl: null, 
            capturedHeaders: { "Referer": "https://iyadtv.pages.dev/", "Origin": "https://iyadtv.pages.dev" }
        };

        // ADAPTIVE STEP 2: Event-Based Header Capture
        page.on('request', request => {
            const url = request.url();
            if ((url.includes('.mpd') || url.includes('.m3u8') || url.includes('manifest')) && !url.includes('chunk')) {
                result.videoUrl = url;
                // Dynamically steal the headers used by the actual site
                const headers = request.headers();
                if (headers['referer']) result.capturedHeaders['Referer'] = headers['referer'];
                if (headers['authorization']) result.capturedHeaders['Authorization'] = headers['authorization'];
            }
            if (url.includes('widevine') || url.includes('license')) result.licenseUrl = url;
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // ADAPTIVE STEP 3: Multi-Stage Interaction
        // Attempt Stage 1: Center Click
        await page.mouse.click(isMobileRequest ? 180 : 640, isMobileRequest ? 400 : 360);
        await page.waitForTimeout(2000);

        // Attempt Stage 2: Hunt for common player buttons if URL still missing
        if (!result.videoUrl) {
            const selectors = ['video', '.vjs-big-play-button', 'button[aria-label="Play"]', '.play-button'];
            for (const s of selectors) {
                if (result.videoUrl) break;
                await page.click(s, { timeout: 2000 }).catch(() => {});
            }
        }

        // ADAPTIVE STEP 4: Extended Polling for "Lazy" streams
        let attempts = 0;
        while (!result.videoUrl && attempts < 40) {
            await page.waitForTimeout(500);
            attempts++;
        }

        if (result.videoUrl) {
            res.json({
                success: true,
                videoUrl: result.videoUrl,
                licenseUrl: result.licenseUrl,
                isDRM: !!result.licenseUrl,
                headers: result.capturedHeaders
            });
        } else {
            // Provide specific feedback for debugging
            res.status(404).json({ 
                success: false, 
                error: "Adaptive capture failed. Site likely using advanced bot-shield or Geo-blocking." 
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Adaptive Resolver Port ${PORT}`));
