const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// Memory-optimized launch settings for Railway
const launchOptions = {
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--single-process',
        '--disable-gpu'
    ]
};

// --- ENDPOINT 1: GET CHANNEL LIST ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
        
        // Block assets to speed up scraping
        await page.route('**/*', (route) => {
            if (['image', 'font', 'stylesheet'].includes(route.request().resourceType())) return route.abort();
            route.continue();
        });

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.channel-card', { timeout: 20000 });

        const channels = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.channel-card')).map((card, index) => {
                const name = card.getAttribute('aria-label') || "Unknown";
                const logo = card.querySelector('.channel-card-logo')?.src || "";
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: logo,
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

// --- ENDPOINT 2: RESOLVE STREAM (The "Universal" Version) ---
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
        let result = { videoUrl: null, licenseUrl: null };

        // THE DRM-HUNTER: Catching manifests and license keys
        page.on('request', req => {
            const url = req.url();
            const method = req.method();
            
            // Capture Manifests
            if ((url.includes('.mpd') || url.includes('.m3u8') || url.includes('master.json')) && !url.includes('chunk')) {
                result.videoUrl = url;
            }

            // Capture Licenses (Widevine, Akamai Proxies, etc.)
            const isLicense = url.includes('widevine') || url.includes('license') || 
                              url.includes('wv') || url.includes('proxy') ||
                              (method === 'POST' && url.includes('akamai'));
            
            if (isLicense) {
                result.licenseUrl = url;
            }
        });

        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // STEP 1: The "Blind Click" to bypass invisible overlays
        await page.mouse.click(640, 360); 

        // STEP 2: Multi-Selector Trigger Click
        const triggerSelectors = [
            '#shaka-player-wrapper', '#hls-player-wrapper', 
            '.vjs-big-play-button', '#video-player-container',
            'button[class*="play"]', 'div[class*="player"]'
        ];

        for (const s of triggerSelectors) {
            try {
                if (await page.isVisible(s)) {
                    await page.click(s, { force: true, timeout: 2000 });
                    break; 
                }
            } catch (e) {}
        }

        // STEP 3: "Stream/Server" Button Detection with Retry
        const sourceBtnSelectors = [
            '#source-buttons-list button:not(.cancel_btn)',
            '.source-btn', 'button:has-text("Stream")', 'button:has-text("Server")'
        ];

        let sourceClicked = false;
        for (let i = 0; i < 5; i++) {
            for (const selector of sourceBtnSelectors) {
                try {
                    const btn = page.locator(selector).first();
                    if (await btn.isVisible()) {
                        await btn.click({ force: true });
                        sourceClicked = true;
                        break;
                    }
                } catch (e) {}
            }
            if (sourceClicked || result.videoUrl) break;
            await page.waitForTimeout(1000);
        }

        // Final wait for network capture
        let attempts = 0;
        while (!result.videoUrl && attempts < 30) {
            await page.waitForTimeout(500);
            attempts++;
            if (attempts === 15 && !sourceClicked) await page.mouse.click(640, 360);
        }

        if (result.videoUrl) {
            res.json({
                success: true,
                videoUrl: result.videoUrl,
                licenseUrl: result.licenseUrl,
                isDRM: !!result.licenseUrl,
                // These headers are CRITICAL for ExoPlayer to bypass 403 errors
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                    "Referer": "https://iyadtv.pages.dev/",
                    "Origin": "https://iyadtv.pages.dev"
                }
            });
        } else {
            res.status(404).json({ success: false, error: "Player remained black or capture timed out." });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Master Resolver running on port ${PORT}`));
