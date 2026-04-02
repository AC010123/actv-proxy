// Add this at the very top of your file to help Railway manage memory
process.setMaxListeners(20);

const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

const launchOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process', // Crucial for Railway
        '--disable-gpu',
        '--no-zygote'
    ]
};

// HELPER: Universal Request Blocker to save RAM
async function setupPageOptimizations(page) {
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        // Block everything except the script and the document
        if (['image', 'font', 'stylesheet', 'media', 'manifest'].includes(type)) {
            return route.abort();
        }
        route.continue();
    });
}

app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
        await setupPageOptimizations(page);

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        
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
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        // Note: For /resolve, we DO NOT block media/manifests because we need to catch them!
        
        let result = { videoUrl: null, licenseUrl: null };

        page.on('request', req => {
            const url = req.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) result.videoUrl = url;
            if (url.includes('widevine') || url.includes('license')) result.licenseUrl = url;
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Rapid Click Logic
        await page.mouse.click(640, 360);
        await page.click('button:has-text("Stream")', { timeout: 3000 }).catch(() => {});

        // Wait up to 10 seconds for the link
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
                isDRM: !!result.licenseUrl,
                headers: {
                    "User-Agent": "Mozilla/5.0...",
                    "Referer": "https://iyadtv.pages.dev/"
                }
            });
        } else {
            res.status(404).json({ error: "Timed out" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Ready on ${PORT}`));
