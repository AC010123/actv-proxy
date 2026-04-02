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

// --- ENDPOINT: RESOLVE STREAM ---
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

        // MONITOR: Catch the .mpd and License URLs in the background
        page.on('request', req => {
            const url = req.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                result.videoUrl = url;
            }
            if (url.includes('widevine') || url.includes('license')) {
                result.licenseUrl = url;
            }
        });

        console.log(`Step 1: Navigating to ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // STEP 1: Click the "Play" area to trigger the source selection
        // Based on the HTML you sent, the player wrappers are the best target
        try {
            const playerSelector = '#shaka-player-wrapper, #hls-player-wrapper, #video-player-container';
            await page.waitForSelector(playerSelector, { timeout: 5000 });
            await page.click(playerSelector);
            console.log("Step 2: Player clicked. Waiting for Source Box...");
        } catch (e) {
            console.log("Player click failed or not needed.");
        }

        // STEP 2: Click the Stream Source (Stream 1)
        try {
            const btnSelector = '#source-buttons-list button:not(.cancel_btn)';
            await page.waitForSelector(btnSelector, { timeout: 8000 });
            await page.click(btnSelector);
            console.log("Step 3: Source selected!");
        } catch (e) {
            console.log("Step 3: Source box never appeared.");
        }

        // STEP 4: Wait for the network to capture the link
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
            res.status(404).json({ success: false, error: "Stream link not found in network logs." });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Resolver active on port ${PORT}`));
