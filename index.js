const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// Simple cache to prevent Railway from getting overwhelmed
let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 Minute Cache

async function fetchLiveChannels() {
    // 1. Check Cache
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        console.log("Serving channels from cache...");
        return cachedChannels;
    }

    console.log("--- Starting Scrape of iyadtv ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Block heavy assets to save memory and speed up load
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        // 2. Visit site and WAIT for it to load
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        // 3. Wait for the actual channel links to appear in the HTML
        await page.waitForSelector('a', { timeout: 10000 }).catch(() => console.log("Timed out waiting for 'a' tags"));

        const channels = await page.evaluate(() => {
            // Find all links on the page
            const items = Array.from(document.querySelectorAll('a'));
            
            return items.map((item, index) => {
                const name = item.innerText.trim();
                const img = item.querySelector('img')?.src;
                const link = item.href;

                // FILTER: Only grab items that have a name and a valid link
                // We ignore common site navigation like "Home" or "Contact"
                if (name && name.length > 2 && link.startsWith('http') && !link.includes('pages.dev/#')) {
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

        console.log(`Successfully found ${channels.length} channels!`);
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

// ROUTE: Get the menu for Android TV
app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

// ROUTE: Get the secret stream link when a channel is clicked
app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ error: "No URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        // Listen for the .m3u8 link in the background
        page.on('request', r => {
            const u = r.url();
            if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
            if (u.includes('widevine') || u.includes('license')) streamData.licenseUrl = u;
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait 5 seconds for the player to initialize and trigger the stream request
        await new Promise(r => setTimeout(r, 5000));
        
        res.json(streamData);
    } catch (e) {
        console.error("Resolve Error:", e.message);
        res.json({ error: "Failed to find stream" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Proxy Station is Online"));

app.listen(port, "0.0.0.0", () => {
    console.log(`Listening on ${port}`);
});
