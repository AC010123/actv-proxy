const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Attempting Scrape ---");
    let browser;
    try {
        // Launch with specific flags for Cloud environments
        browser = await chromium.launch({ 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--single-process'
            ] 
        });
        
        const page = await browser.newPage();
        await page.route('**/*.{png,jpg,jpeg,css,woff,svg}', route => route.abort());
        
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 45000 });

        const channels = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.map((a, index) => {
                const name = a.innerText.trim();
                const href = a.href;
                if (name.length > 1 && href.startsWith('http')) {
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
        console.log(`Scrape successful: found ${channels.length} channels`);
        return channels;

    } catch (e) {
        console.error("CRITICAL SCRAPE ERROR:", e.message);
        // If it's the "Executable doesn't exist" error, this will show in logs
        return cachedChannels || [{ id: "err", name: "Server starting up, refresh in 1 min", category: "SYSTEM" }];
    } finally {
        if (browser) await browser.close();
    }
}

app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.json({ error: "No URL" });
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };
        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
        });
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));
        res.json(streamData);
    } catch (e) {
        res.json({ error: "Resolve failed" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Proxy Ready"));

app.listen(port, "0.0.0.0", () => console.log(`Server listening on ${port}`));
