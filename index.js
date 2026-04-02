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
        '--no-zygote'
    ]
};

// Optimization: Blocks heavy assets to save RAM and speed up load times
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

        // Increased timeout to 60s for the initial list load
        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
        
        // Wait specifically for the cards to appear
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
        
        console.log(`Successfully fetched ${channels.length} channels.`);
        res.json(channels);
    } catch (error) {
        console.error("Channel Fetch Error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: RESOLVE STREAM ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        let result = { videoUrl: null, licenseUrl: null };

        // Better detection logic
        page.on('request', request => {
            const url = request.url();
            const method = request.method();

            // Detect Video Manifests
            if ((url.includes('.mpd') || url.includes('.m3u8') || url.includes('index.json') || url.includes('master')) && !url.includes('chunk')) {
                result.videoUrl = url;
            }

            // Detect DRM Licenses
            const isDRM = url.includes('widevine') || url.includes('license') || url.includes('wv') || (method === 'POST' && url.includes('akamai'));
            if (isDRM) {
                result.licenseUrl = url;
            }
        });

        console.log(`Resolving: ${targetUrl}`);
        // Go to page and wait for things to settle
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Trigger clicks to start the player
        await page.mouse.click(640, 360);
        await page.waitForTimeout(1000);
        
        // Try clicking common "Play" or "Server" buttons
        const playSelectors = ['button:has-text("Stream")', 'button:has-text("Server")', '.vjs-big-play-button'];
        for (const s of playSelectors) {
            try { await page.click(s, { timeout: 2000 }); } catch (e) {}
        }

        // Poll for the URL for up to 15 seconds
        let attempts = 0;
        while (!result.videoUrl && attempts < 30) {
            await page.waitForTimeout(500);
            attempts++;
        }

        if (result.videoUrl) {
            res.json({
                success: true,
                videoUrl: result.videoUrl,
                licenseUrl: result.licenseUrl,
                isDRM: !!result.licenseUrl,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                    "Referer": "https://iyadtv.pages.dev/",
                    "Origin": "https://iyadtv.pages.dev"
                }
            });
        } else {
            res.status(404).json({ success: false, error: "Stream not found. Player remained black." });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Resolver Active on Port ${PORT}`));
