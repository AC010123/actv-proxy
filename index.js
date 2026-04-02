const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// Simple cache to prevent overwhelming the server or getting blocked
let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Starting Scrape (v1.59.0) ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Speed up: ignore images and css
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        // Wait for the site to finish loading its dynamic grid
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        const channels = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('a'));
            
            return items.map((item, index) => {
                const name = item.innerText.trim();
                const link = item.href;
                const img = item.querySelector('img')?.src;

                // --- IMPROVED FILTERING ---
                // We ignore utility links, social media, and site navigation
                const isUtility = /Support|Version|Close|Discord|Telegram|v1\./i.test(name);
                const isAnchorOnly = link.endsWith('#') || link.includes('javascript:');
                
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

        console.log(`Found ${channels.length} valid channels.`);
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

        // Sniff for the .m3u8 or .mpd stream and DRM license URL
        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Wait longer for the player to initialize and trigger the stream request
        await new Promise(r => setTimeout(r, 8000));
        
        res.json(streamData);
    } catch (e) {
        console.error("Resolve Error:", e.message);
        res.json({ error: "Failed to resolve stream" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Station Online"));
app.listen(port, "0.0.0.0", () => console.log(`Proxy listening on ${port}`));
