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
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        // Speed up scraping by ignoring heavy assets
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        const channels = await page.evaluate((baseUrl) => {
            // 1. Target all potential interactive elements
            const elements = Array.from(document.querySelectorAll('a, [onclick], .grid-item, div.card'));
            
            const results = elements.map((el) => {
                const name = el.innerText?.trim() || "";
                const img = el.querySelector('img')?.src || null;
                
                // 2. Logic fix: Check self OR parent for the onclick attribute
                const onclick = el.getAttribute('onclick') || el.parentElement?.getAttribute('onclick') || "";

                // 3. Junk filter: Remove support tiles and versioning
                const isJunk = /Contact|Support|Version|Close|Discord|Telegram|Update|v1\./i.test(name);
                if (isJunk || name.length < 2) return null;

                // 4. Extraction fix: Specifically look for the play('slug') pattern
                const match = onclick.match(/play\(['"]([^'"]+)['"]\)/);
                const slug = match ? match[1] : null;

                // If no slug found, it's not a playable channel tile
                if (!slug) return null;

                return {
                    name: name,
                    logoUrl: img,
                    category: "LIVE",
                    websiteUrl: `${baseUrl}play/${slug}`,
                    directUrl: null
                };
            }).filter(item => item !== null);

            // Deduplicate by name
            return Array.from(new Map(results.map(c => [c.name, c])).values());
        }, TARGET_SITE);

        // Re-assign sequential IDs to keep the TV list clean
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
    if (!url || url === "null") return res.status(400).json({ error: "Invalid URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        let streamData = { videoUrl: null, licenseUrl: null };

        // Optimized listener for Master Playlists and DRM
        page.on('request', r => {
            const u = r.url();
            
            // Prioritize main playlists; exclude short-lived segments/chunks
            if ((u.includes('.m3u8') || u.includes('.mpd')) && !u.includes('chunk') && !u.includes('segment')) {
                streamData.videoUrl = u;
            }

            // Identify DRM license handshakes
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey') || u.includes('drm')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        
        // Wait for player initialization and network requests to fire
        await new Promise(r => setTimeout(r, 12000)); 
        
        console.log(`Resolved: ${streamData.videoUrl ? 'Success' : 'Failed'}`);
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
