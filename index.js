const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// Cache to prevent "502 Bad Gateway" timeouts
let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 Minute Cache

async function fetchLiveChannels() {
    // Return cache if it's fresh
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        console.log("Serving from Cache");
        return cachedChannels;
    }

    console.log("--- Starting Scraper ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Speed Hack: Block heavy images/CSS
        await page.route('**/*.{png,jpg,jpeg,css,woff,svg}', route => route.abort());

        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const channels = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a'));
            return anchors.map((a, index) => {
                const name = a.innerText.trim();
                const href = a.href;
                if (name.length > 1 && href.includes('http') && !href.includes('google')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: null, // Scraped without images for max speed
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
        console.error("Scrape Failed:", e.message);
        return cachedChannels || []; // Fallback to old cache if available
    } finally {
        if (browser) await browser.close();
    }
}

// Routes
app.get('/channels', async (req, res) => {
    try {
        const list = await fetchLiveChannels();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.json({ error: "No URL" });

    let browser;
    try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(r => setTimeout(r, 4000));
        res.json(streamData);
    } catch (e) {
        res.json({ error: "Resolve failed" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Station Active"));

app.listen(port, "0.0.0.0", () => console.log(`Online on ${port}`));
