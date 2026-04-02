const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// Cache to save Railway resources and avoid being blocked
let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Starting ACtv Grid Scrape ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Block heavy assets to speed up loading
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        // Ensure the grid is actually rendered
        await page.waitForSelector('img', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            // Target the cards seen in your screenshots
            const cards = Array.from(document.querySelectorAll('a, div.card, .grid-item, [role="button"]'));
            
            return cards.map((card, index) => {
                const name = card.innerText.trim();
                const img = card.querySelector('img')?.src;
                
                // Extract the link or the ID from the onclick attribute
                let href = card.href || "";
                const onclick = card.getAttribute('onclick') || "";
                
                // If it's a JS 'play' function, we extract the slug (e.g., 'tv5')
                if (!href || href.includes('#')) {
                    const match = onclick.match(/'([^']+)'/);
                    if (match) href = `https://iyadtv.pages.dev/play/${match[1]}`;
                }

                // Filtering "Junk" and Navigation
                const isSystem = /Contact|Support|Version|Close|Discord|Telegram|v1\./i.test(name);
                const isValidLink = href.startsWith('http');

                if (name && name.length > 1 && !isSystem && isValidLink) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: img || null,
                        category: "LIVE",
                        websiteUrl: href,
                        directUrl: null
                    };
                }
                return null;
            }).filter(x => x !== null);
        });

        // Deduplicate by name to keep the list clean
        const uniqueChannels = Array.from(new Map(channels.map(c => [c.name, c])).values());

        console.log(`Successfully indexed ${uniqueChannels.length} channels.`);
        cachedChannels = uniqueChannels;
        lastFetchTime = Date.now();
        return uniqueChannels;

    } catch (e) {
        console.error("Scrape Error:", e.message);
        return cachedChannels || [];
    } finally {
        if (browser) await browser.close();
    }
}

// ENDPOINT: Get Channel List for Android TV
app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

// ENDPOINT: Extract Stream and DRM License
app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url || url === "null") return res.json({ error: "Invalid URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        // Listen for video manifests and DRM license requests
        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        
        // Wait for the player to initialize and trigger the background requests
        await new Promise(r => setTimeout(r, 10000));
        
        res.json(streamData);
    } catch (e) {
        console.error("Resolve Error:", e.message);
        res.json({ error: "Failed to resolve stream" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Proxy Station: Online"));

app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
});
