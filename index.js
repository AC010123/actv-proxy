const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Refreshing ACtv Channel List ---");
    let browser;
    try {
        // STEALTH: Added more flags to bypass bot detection on Railway
        browser = await chromium.launch({ 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ] 
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        const page = await context.newPage();
        
        // Go to site and wait for the actual grid to load
        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // WAIT: Specifically wait for the channel cards to appear in the DOM
        try {
            await page.waitForSelector('[onclick*="play"]', { timeout: 15000 });
        } catch (e) {
            console.log("Timed out waiting for channel cards. The site might be blocking the request.");
        }

        const channels = await page.evaluate((baseUrl) => {
            // Target the specific cards shown in your screenshot
            const cards = Array.from(document.querySelectorAll('[onclick*="play"]'));
            
            const results = cards.map((el) => {
                const name = el.innerText?.trim() || "";
                const img = el.querySelector('img')?.src || null;
                const onclick = el.getAttribute('onclick') || "";

                // Filter out UI elements that aren't actual channels
                const isJunk = /Contact|Support|Version|Close|Discord|Telegram|Update|v1\./i.test(name);
                if (isJunk || name.length < 2) return null;

                const match = onclick.match(/play\(['"]([^'"]+)['"]\)/);
                const slug = match ? match[1] : null;

                if (!slug) return null;

                return {
                    name: name,
                    logoUrl: img,
                    category: "LIVE",
                    websiteUrl: `${baseUrl}play/${slug}`,
                    directUrl: null
                };
            }).filter(Boolean);

            return Array.from(new Map(results.map(c => [c.name, c])).values());
        }, TARGET_SITE);

        if (channels.length === 0) {
            console.log("Warning: Scraper returned 0 channels.");
            return cachedChannels || [];
        }

        const finalChannels = channels.map((c, i) => ({ id: String(i + 1), ...c }));
        
        console.log(`Successfully indexed ${finalChannels.length} channels.`);
        cachedChannels = finalChannels;
        lastFetchTime = Date.now();
        return finalChannels;

    } catch (e) {
        console.error("Scrape Error:", e.message);
        return cachedChannels || [];
    } finally {
        if (browser) await browser.close();
    }
}

app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url || url === "null") return res.status(400).json({ error: "Invalid URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        page.on('request', r => {
            const u = r.url();
            if ((u.includes('.m3u8') || u.includes('.mpd')) && !u.includes('chunk') && !u.includes('segment')) {
                streamData.videoUrl = u;
            }
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey') || u.includes('drm')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

        // Handle the stream selection popup
        try {
            const streamButton = await page.waitForSelector('button, .stream-option, [role="button"]', { timeout: 8000 });
            if (streamButton) {
                await streamButton.click();
            }
        } catch (err) {
            // Popup might not appear for every channel
        }

        // Give it time to capture the network requests
        await new Promise(r => setTimeout(r, 12000)); 
        res.json(streamData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Backend: Online"));

app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Server running on port ${port}`);
});
