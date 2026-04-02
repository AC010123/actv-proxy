const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// --- ENDPOINT 1: GET CHANNEL LIST ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        // Advanced launch args to prevent Railway memory crashes
        browser = await chromium.launch({ 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', // Critical for cloud hosting
                '--disable-accelerated-2d-canvas',
                '--no-first-run'
            ] 
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Navigate to the HOME page where the grid lives
        await page.goto('https://iyadtv.pages.dev/', { 
            waitUntil: 'networkidle', 
            timeout: 60000 
        });

        const channels = await page.evaluate(() => {
            // Find all anchor tags that lead to a player page
            const items = Array.from(document.querySelectorAll('a[href*="/play/"]'));
            return items.map((item, index) => {
                const name = item.querySelector('h3')?.innerText || "Unknown Channel";
                const logo = item.querySelector('img')?.src || "";
                const slug = item.getAttribute('href').split('/').pop();
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: logo,
                    category: "LIVE",
                    websiteUrl: `https://iyadtv.pages.dev/play/${slug}`,
                    directUrl: null // Resolved later via /resolve
                };
            });
        });

        res.json(channels);
    } catch (error) {
        console.error("Channels Error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: RESOLVE SPECIFIC STREAM ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing URL" });

    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        // Instant popup killer
        context.on('page', async popup => { await popup.close(); });

        const page = await context.newPage();
        let finalStream = { videoUrl: null, licenseUrl: null };

        // Monitor network for DASH/HLS manifests and Widevine licenses
        page.on('request', request => {
            const url = request.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                finalStream.videoUrl = url;
            }
            if (url.includes('widevine') || url.includes('license')) {
                finalStream.licenseUrl = url;
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // Handle the "Source Selection" box from your screenshot
        try {
            const selectionBox = '#source-selection-box';
            await page.waitForSelector(selectionBox, { timeout: 5000 });
            
            const buttons = page.locator('#source-buttons-list button:not(.cancel_btn)');
            if (await buttons.count() > 0) {
                await buttons.first().click();
            }
        } catch (e) {
            console.log("No source box, waiting for auto-play...");
        }

        // Give the player time to generate the manifest link
        await page.waitForTimeout(7000);

        if (finalStream.videoUrl) {
            res.json({ 
                success: true, 
                ...finalStream,
                isDRM: !!finalStream.licenseUrl 
            });
        } else {
            res.status(404).json({ success: false, error: "Stream link not found." });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`ACtv Proxy running on port ${PORT}`);
});
