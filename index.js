const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// Cache variables to prevent constant slow scraping
let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

async function fetchLiveChannels() {
    // If we have a fresh cache, use it immediately!
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        console.log("Serving channels from cache...");
        return cachedChannels;
    }

    console.log("--- Starting Speed Scrape ---");
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
    });
    
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Block images and CSS to make the scrape 5x faster
        await page.route('**/*.{png,jpg,jpeg,css,woff,svg}', route => route.abort());

        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const channels = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a'));
            return anchors.map((a, index) => {
                const name = a.innerText.trim();
                const href = a.href;
                // Basic filter for channel links
                if (name.length > 1 && href.includes('http') && !href.includes('google')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: null, // Images blocked for speed, but names will load!
                        category: "LIVE",
                        websiteUrl: href,
                        directUrl: null
                    };
                }
                return null;
            }).filter(item => item !== null);
        });

        cachedChannels = channels;
        lastFetchTime = Date.now();
        return channels;
    } catch (e) {
        console.error("Scrape Error:", e.message);
        return cachedChannels || []; // Return old cache if new scrape fails
    } finally {
        await browser.close();
    }
}

app.get('/channels', async (req, res) => {
    // Send a response quickly to avoid Railway timeout
    const list = await fetchLiveChannels();
    res.json(list);
});

// Resolver stays the same for individual links
app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ error: "No URL" });
    
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    let streamData = { videoUrl: null, licenseUrl: null };

    page.on('request', r => {
        const u = r.url();
        if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(r => setTimeout(r, 4000));
    } finally {
        await browser.close();
    }
    res.json(streamData);
});

app.get('/', (req, res) => res.send("Station Active"));

app.listen(port, "0.0.0.0", () => console.log(`Online on ${port}`));
