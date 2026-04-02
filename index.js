const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Navigate to the ROOT domain
        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });

        // CRITICAL: Wait for the JavaScript (app.js) to inject the channels into the grid
        // We wait for the first <a> tag to appear inside #channel-grid
        await page.waitForSelector('#channel-grid a', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            const grid = document.querySelector('#channel-grid');
            const items = Array.from(grid.querySelectorAll('a'));
            
            return items.map((item, index) => {
                const name = item.querySelector('h3')?.innerText || "Unknown";
                const logo = item.querySelector('img')?.src || "";
                // Get the slug from the href (e.g., /play/tv5 -> tv5)
                const slug = item.getAttribute('href').split('/').pop();
                
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: logo,
                    category: "LIVE",
                    websiteUrl: `https://iyadtv.pages.dev/play/${slug}`,
                    directUrl: null
                };
            });
        });

        res.json(channels);
    } catch (error) {
        console.error("Scrape Error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing URL" });

    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        context.on('page', async popup => { await popup.close(); });

        const page = await context.newPage();
        let finalStream = { videoUrl: null, licenseUrl: null };

        page.on('request', request => {
            const url = request.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                finalStream.videoUrl = url;
            }
            if (url.includes('widevine') || url.includes('license')) {
                finalStream.licenseUrl = url;
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle' });

        // Handle the source selection box
        try {
            await page.waitForSelector('#source-selection-box', { timeout: 5000 });
            const buttons = page.locator('#source-buttons-list button:not(.cancel_btn)');
            if (await buttons.count() > 0) {
                await buttons.first().click();
            }
        } catch (e) { /* Box might not appear for all channels */ }

        await page.waitForTimeout(7000);

        if (finalStream.videoUrl) {
            res.json({ 
                success: true, 
                ...finalStream,
                isDRM: !!finalStream.licenseUrl 
            });
        } else {
            res.status(404).json({ error: "Stream link not found" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => { console.log(`Server on port ${PORT}`); });
