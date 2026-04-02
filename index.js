process.setMaxListeners(30);
const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

const launchOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream',
        '--disable-features=IsolateOrigins,site-per-process'
    ]
};

// Restore the channel list endpoint
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
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

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
        });

        const page = await context.newPage();
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        });

        let result = { 
            videoUrl: null, 
            licenseUrl: null, 
            capturedHeaders: { "Referer": "https://iyadtv.pages.dev/", "Origin": "https://iyadtv.pages.dev" }
        };

        // Network Listener
        page.on('request', request => {
            const url = request.url();
            if ((url.includes('.mpd') || url.includes('.m3u8') || url.includes('manifest')) && !url.includes('chunk')) {
                result.videoUrl = url;
                const headers = request.headers();
                if (headers['referer']) result.capturedHeaders['Referer'] = headers['referer'];
            }
            if (url.includes('widevine') || url.includes('license')) result.licenseUrl = url;
        });

        await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });

        // DEEP HUNT: If network listener missed it, search the page HTML for the URL
        if (!result.videoUrl) {
            const foundUrl = await page.evaluate(() => {
                const scripts = Array.from(document.scripts).map(s => s.innerHTML).join(' ');
                const match = scripts.match(/https?:\/\/[^"']+\.(m3u8|mpd)[^"']*/);
                return match ? match[0] : null;
            });
            if (foundUrl) result.videoUrl = foundUrl;
        }

        // Trigger Click for lazy loaders
        await page.mouse.click(640, 360);
        await page.waitForTimeout(3000);

        if (result.videoUrl) {
            res.json({
                success: true,
                videoUrl: result.videoUrl,
                licenseUrl: result.licenseUrl,
                isDRM: !!result.licenseUrl,
                headers: result.capturedHeaders
            });
        } else {
            res.status(404).json({ success: false, error: "Adaptive capture failed. The site is actively blocking Datacenter IPs." });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Active on Port ${PORT}`));
