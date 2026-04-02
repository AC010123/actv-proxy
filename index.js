const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// Helper to block heavy resources (Ads, Images, Fonts) to save Railway RAM
const setupOptimizedContext = async (browser) => {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    
    // Auto-close any ad popups immediately
    context.on('page', async popup => { try { await popup.close(); } catch (e) {} });

    return context;
};

const blockHeavyResources = async (page) => {
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        const url = route.request().url();
        // Block images, fonts, and common ad/tracking scripts
        if (['image', 'font', 'media'].includes(type) || url.includes('google-analytics') || url.includes('doubleclick')) {
            return route.abort();
        }
        route.continue();
    });
};

// --- ENDPOINT 1: GET CHANNEL LIST ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
        });
        const context = await setupOptimizedContext(browser);
        const page = await context.newPage();
        await blockHeavyResources(page);

        // Navigate to Root (Not /channels)
        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 45000 });

        // Wait for the JS to inject the channel grid
        await page.waitForSelector('#channel-grid a', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            const grid = document.querySelector('#channel-grid');
            const items = Array.from(grid.querySelectorAll('a[href*="/play/"]'));
            return items.map((item, index) => {
                const name = item.querySelector('h3')?.innerText || "Unknown";
                const logo = item.querySelector('img')?.src || "";
                const slug = item.getAttribute('href').split('/').pop();
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: logo,
                    category: "LIVE",
                    websiteUrl: `https://iyadtv.pages.dev/play/${slug}`
                };
            });
        });

        res.json(channels);
    } catch (error) {
        console.error("Channels Scrape Failed:", error.message);
        res.status(500).json({ error: "Failed to load channel list. Check Railway logs for memory limits." });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: RESOLVE STREAM URL ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing URL parameter" });

    let browser;
    try {
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process'] 
        });
        const context = await setupOptimizedContext(browser);
        const page = await context.newPage();
        
        // We DON'T block all resources here because the player needs some scripts to load manifests
        let finalStream = { videoUrl: null, licenseUrl: null };

        page.on('request', request => {
            const url = request.url();
            // Catch Manifests (.mpd, .m3u8)
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                finalStream.videoUrl = url;
            }
            // Catch Widevine License URLs
            if (url.includes('widevine') || url.includes('license')) {
                finalStream.licenseUrl = url;
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

        // Auto-click the "Source Selection" button from your screenshot
        try {
            await page.waitForSelector('#source-selection-box', { timeout: 5000 });
            const buttons = page.locator('#source-buttons-list button:not(.cancel_btn)');
            if (await buttons.count() > 0) {
                await buttons.first().click();
            }
        } catch (e) { /* Selection box didn't appear */ }

        // Wait for network handshake to complete
        await page.waitForTimeout(8000);

        if (finalStream.videoUrl) {
            res.json({
                success: true,
                videoUrl: finalStream.videoUrl,
                licenseUrl: finalStream.licenseUrl,
                isDRM: !!finalStream.licenseUrl
            });
        } else {
            res.status(404).json({ error: "Stream manifest not detected." });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`ACtv Backend listening on port ${PORT}`);
});
