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

// --- ENDPOINT 1: GET CHANNEL LIST ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext();
        const page = await context.newPage();

        // Block CSS/Images to save RAM during the list fetch
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'stylesheet'].includes(type)) return route.abort();
            route.continue();
        });

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#channel-grid a', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#channel-grid a[href*="/play/"]')).map((item, index) => ({
                id: (index + 1).toString(),
                name: item.querySelector('h3')?.innerText || "Unknown",
                logoUrl: item.querySelector('img')?.src || "",
                websiteUrl: item.href
            }));
        });

        res.json(channels);
    } catch (error) {
        res.status(500).json({ error: "Failed to load channels" });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: RESOLVE STREAM (Optimized for 3RS Flow) ---
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

        // Listen for the manifest and license in the background
        page.on('request', req => {
            const url = req.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                result.videoUrl = url;
            }
            if (url.includes('widevine') || url.includes('license')) {
                result.licenseUrl = url;
            }
        });

        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // STEP 1: Click the Player to trigger the popup
        // We look for the main video container or play button
        try {
            await page.waitForSelector('#shaka-player-wrapper, #hls-player-wrapper', { timeout: 5000 });
            await page.click('#shaka-player-wrapper, #hls-player-wrapper');
            console.log("Initial player clicked...");
        } catch (e) {
            console.log("No initial player found or already active.");
        }

        // STEP 2: Wait for the Source Selection Box and click the first stream
        try {
            const btnSelector = '#source-buttons-list button:not(.cancel_btn)';
            await page.waitForSelector(btnSelector, { timeout: 7000 });
            
            // This clicks the FIRST stream link (e.g., 3RS Stream 1)
            await page.click(btnSelector);
            console.log("Source stream button clicked.");
        } catch (e) {
            console.log("Source selection box didn't appear. Site might be slow.");
        }

        // STEP 3: Wait for the manifest to appear in network logs
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

app.listen(PORT, () => console.log(`ACtv Backend on port ${PORT}`));
