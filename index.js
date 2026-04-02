const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
};

app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
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
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) result.videoUrl = url;
            if (url.includes('widevine') || url.includes('license')) result.licenseUrl = url;
        });

        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // FIX 1: Try multiple possible player triggers
        const triggerSelectors = [
            '#shaka-player-wrapper', 
            '#hls-player-wrapper', 
            '.vjs-big-play-button', 
            '#video-player-container',
            '.channel-player-container' // Added a generic one
        ];

        for (const selector of triggerSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    await page.click(selector);
                    console.log(`Clicked trigger: ${selector}`);
                    break; 
                }
            } catch (e) {}
        }

        // FIX 2: More flexible "Stream" button selection
        // Some channels might use "Stream 1", others just "Server 1"
        const sourceBtnSelectors = [
            '#source-buttons-list button:not(.cancel_btn)',
            '.source-btn',
            'button:has-text("Stream")',
            'button:has-text("Server")'
        ];

        let sourceClicked = false;
        for (let i = 0; i < 5; i++) { // Retry loop
            for (const selector of sourceBtnSelectors) {
                try {
                    const btn = page.locator(selector).first();
                    if (await btn.isVisible()) {
                        await btn.click();
                        console.log(`Clicked source button using: ${selector}`);
                        sourceClicked = true;
                        break;
                    }
                } catch (e) {}
            }
            if (sourceClicked || result.videoUrl) break;
            await page.waitForTimeout(1000); // Wait 1s between retries
        }

        // Final wait for network capture
        let attempts = 0;
        while (!result.videoUrl && attempts < 20) {
            await page.waitForTimeout(500);
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
            res.status(404).json({ success: false, error: "Stream capture timed out." });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Resolver running on ${PORT}`));
