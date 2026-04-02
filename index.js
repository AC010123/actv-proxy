const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// Reusable launch options to keep RAM low
const launchOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu'
    ]
};

// Endpoint 1: Fetch the Channel List
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();

        // Block everything except the bare HTML and the app.js
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
                return route.abort();
            }
            route.continue();
        });

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Wait for the JS grid to populate
        await page.waitForSelector('#channel-grid a', { timeout: 10000 });

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
        res.status(500).json({ error: "RAM Limit hit or Timeout. Try again." });
    } finally {
        if (browser) await browser.close();
    }
});

// Endpoint 2: Resolve the Stream
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL");

    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
        let result = { videoUrl: null, licenseUrl: null };

        // Listen for the manifest and license
        page.on('request', req => {
            const url = req.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) result.videoUrl = url;
            if (url.includes('widevine') || url.includes('license')) result.licenseUrl = url;
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // Handle the source selection box automatically
        try {
            await page.waitForSelector('#source-selection-box', { timeout: 4000 });
            await page.click('#source-buttons-list button:not(.cancel_btn)');
        } catch (e) {}

        // Shorter wait to save memory
        await page.waitForTimeout(5000);

        res.json({ ...result, isDRM: !!result.licenseUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Stable ACtv Proxy on ${PORT}`));
