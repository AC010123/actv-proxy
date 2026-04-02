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
        '--disable-blink-features=AutomationControlled' // Hides "Automation" flag
    ]
};

// Optimization: Blocks non-essential assets to save Railway RAM
async function setupPageOptimizations(page, blockMedia = true) {
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        const toBlock = ['image', 'font', 'stylesheet'];
        if (blockMedia) toBlock.push('media', 'manifest'); 
        
        if (toBlock.includes(type)) return route.abort();
        route.continue();
    });
}

// --- ENDPOINT 1: GET CHANNEL LIST ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
        await setupPageOptimizations(page, true);

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForSelector('.channel-card', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.channel-card')).map((card, index) => {
                const name = card.getAttribute('aria-label') || "Unknown";
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: card.querySelector('.channel-card-logo')?.src || "",
                    websiteUrl: `https://iyadtv.pages.dev/watch?v=${encodeURIComponent(name)}`
                };
            });
        });
        
        res.json(channels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: ADAPTIVE RESOLVER ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        const page = await context.newPage();

        // STEALTH: Remove the "webdriver" property so the site thinks you are a real human
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        let result = { 
            videoUrl: null, 
            licenseUrl: null, 
            capturedHeaders: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                "Referer": "https://iyadtv.pages.dev/",
                "Origin": "https://iyadtv.pages.dev"
            }
        };

        // ADAPTIVE DETECTION: Listen for the stream request and grab its headers
        page.on('request', request => {
            const url = request.url();
            const method = request.method();

            if ((url.includes('.mpd') || url.includes('.m3u8') || url.includes('manifest') || url.includes('master')) && !url.includes('chunk')) {
                result.videoUrl = url;
                // Capture specific headers if the site requires custom Referers or Tokens
                const headers = request.headers();
                if (headers['referer']) result.capturedHeaders['Referer'] = headers['referer'];
                if (headers['origin']) result.capturedHeaders['Origin'] = headers['origin'];
            }

            const isDRM = url.includes('widevine') || url.includes('license') || url.includes('wv') || (method === 'POST' && url.includes('akamai'));
            if (isDRM) result.licenseUrl = url;
        });

        console.log(`Adaptive Resolving: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // INTERACT: Click middle of the player to trigger lazy-loaded streams
        await page.mouse.click(640, 360);
        await page.waitForTimeout(2000);

        // Try clicking multiple types of "Play" buttons found on different sites
        const playSelectors = [
            'button:has-text("Stream")', 
            'button:has-text("Server")', 
            '.vjs-big-play-button',
            '.play-button',
            'video'
        ];
        
        for (const s of playSelectors) {
            try { await page.click(s, { timeout: 1500 }); } catch (e) {}
        }

        // ADAPTIVE POLLING: Wait up to 20 seconds for the manifest to appear in network logs
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
            res.status(404).json({ success: false, error: "Stream not found. Check if the site requires a mobile User-Agent or has Geo-blocking." });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Adaptive Resolver Active on Port ${PORT}`));
