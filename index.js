const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Refreshing ACtv Channel List ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Speed up scraping by ignoring images/css during the initial scan
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        const channels = await page.evaluate((baseUrl) => {
            // Target the cards/buttons specifically
            const elements = Array.from(document.querySelectorAll('a, [onclick], .grid-item'));
            
            const filtered = elements.map((el) => {
                const name = el.innerText.trim();
                const img = el.querySelector('img')?.src || null;
                const onclick = el.getAttribute('onclick') || "";

                // 1. THE "JUNK" FILTER: Remove non-media tiles
                const isJunk = /Contact|Support|Version|Close|Discord|Telegram|Update|v1\./i.test(name);
                if (isJunk || !name || name.length < 2) return null;

                // 2. EXTRACT PLAY ID: Look for the slug in the onclick function
                // Example: onclick="play('tv5')" -> extracts 'tv5'
                const match = onclick.match(/'([^']+)'/);
                const slug = match ? match[1] : null;

                return {
                    name: name,
                    logoUrl: img,
                    category: "LIVE",
                    websiteUrl: slug ? `${baseUrl}play/${slug}` : null
                };
            }).filter(item => item !== null && item.websiteUrl !== null);

            // Deduplicate by name to prevent repeating "Contact Us" or navigation duplicates
            return Array.from(new Map(filtered.map(c => [c.name, c])).values());
        }, TARGET_SITE);

        // Re-assign IDs so they are clean (1, 2, 3...) after filtering
        const finalChannels = channels.map((c, i) => ({ id: String(i + 1), ...c }));

        console.log(`Successfully indexed ${finalChannels.length} clean channels.`);
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
    if (!url) return res.status(400).json({ error: "No URL provided" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await new Promise(r => setTimeout(r, 8000)); // Wait for player to init
        
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
