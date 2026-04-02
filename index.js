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
        '--disable-gpu'
    ]
};

// --- ENDPOINT 1: GET CHANNEL LIST (With URL Encoding Fix) ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();

        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'stylesheet'].includes(type)) return route.abort();
            route.continue();
        });

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.channel-card', { timeout: 20000 });

        const channels = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.channel-card'));
            return cards.map((card, index) => {
                const name = card.getAttribute('aria-label') || "Unknown";
                const logo = card.querySelector('.channel-card-logo')?.src || "";
                
                // THE FIX: Use encodeURIComponent to handle spaces as %20
                // This ensures "ABC Australia" becomes "ABC%20Australia"
                const slug = encodeURIComponent(name);
                
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: logo,
                    websiteUrl: `https://iyadtv.pages.dev/watch?v=${slug}`
                };
            });
        });

        console.log(`Success: Found ${channels.length} channels.`);
        res.json(channels);
    } catch (error) {
        console.error("List Scrape Failed:", error.message);
        res.status(500).json({ error: "Failed to load channel grid." });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: RESOLVE STREAM (Verified 3RSTV Flow) ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        let result = { videoUrl: null, licenseUrl: null };

        page.on('request', req => {
            const url = req.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                result.videoUrl = url;
            }
            if (url.includes('widevine') || url.includes('license')) {
                result.licenseUrl = url;
            }
        });

        // Use 'networkidle' here to ensure the JS player scripts are fully ready
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // STEP 1: Click the player
        try {
            const playerSelector = '#shaka-player-wrapper, #hls-player-wrapper, #video-player-container';
            await page.waitForSelector(playerSelector, { timeout: 5000 });
            await page.click(playerSelector);
        } catch (e) {
            console.log("Player click skipped.");
        }

        // STEP 2: Click "Stream 1"
        try {
            const btnSelector = '#source-buttons-list button:not(.cancel_btn)';
            await page.waitForSelector(btnSelector, { timeout: 8000 });
            await page.click(btnSelector);
        } catch (e) {
            console.log("Source box didn't appear.");
        }

        // STEP 3: Wait for the link capture
        let attempts = 0;
        while (!result.videoUrl && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (result.videoUrl) {
            res.json({
                success: true,
                videoUrl: result.videoUrl,
                licenseUrl: result.licenseUrl,
                isDRM: !!result.licenseUrl
            });
        } else {
            res.status(404).json({ success: false, error: "Stream link not captured." });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Backend Active on Port ${PORT}`));
