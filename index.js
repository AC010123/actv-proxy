const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// Simple cache
let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    let browser;
    try {
        // The Docker image makes this launch much smoother
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        const page = await browser.newPage();
        // Speed up: ignore images/css
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const channels = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.map((a, index) => {
                const name = a.innerText.trim();
                const href = a.href;
                if (name.length > 1 && href.startsWith('http') && !href.includes('google')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: a.querySelector('img')?.src || null,
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
    if (!url) return res.json({ error: "No URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));
        res.json(streamData);
    } catch (e) {
        res.json({ error: "Failed" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("Proxy Live"));
app.listen(port, "0.0.0.0", () => console.log(`Listening on ${port}`));
