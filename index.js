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

    console.log("--- Starting Deep Scrape ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Block heavy assets
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        const channels = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('a'));
            
            return items.map((item, index) => {
                const name = item.innerText.trim();
                const link = item.href;
                const img = item.querySelector('img')?.src;

                // --- SPECIFIC CHANNEL FILTERING ---
                // We want to EXCLUDE the utility links you just saw
                const isUtility = /Support|Version|Close|Discord|Telegram|PH Radio|Stream Player|18\+|v1\./i.test(name);
                const isAnchorOnly = link.endsWith('#') || link.includes('javascript:');
                
                // Only keep links that look like actual TV Stations
                if (name && name.length > 2 && !isUtility && !isAnchorOnly && link.startsWith('http')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: img || null,
                        category: "LIVE",
                        websiteUrl: link,
                        directUrl: null
                    };
                }
                return null;
            }).filter(x => x !== null);
        });

        console.log(`Found ${channels.length} valid TV channels.`);
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
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        page.on('request', r => {
            const u = r.url();
            // Sniff for .m3u8, .mpd, and DRM license keys
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await new Promise(r => setTimeout(r, 8000));
        
        res.json(streamData);
    } catch (e) {
        res.json({ error: "Failed to resolve stream" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Proxy Active"));
app.listen(port, "0.0.0.0", () => console.log(`Proxy listening on ${port}`));
