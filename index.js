const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Scraping Channel Grid ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        // Go to site and wait until the network is quiet
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        // WAIT specifically for the grid items to appear
        // Based on the image, we look for elements that contain text or images
        await page.waitForSelector('img', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            // We look for all elements that behave like a 'card'
            // Usually, these are <a> tags OR divs with an onclick
            const cards = Array.from(document.querySelectorAll('a, div[role="button"], .card'));
            
            return cards.map((card, index) => {
                const name = card.innerText.trim();
                const img = card.querySelector('img')?.src;
                const link = card.href || card.getAttribute('onclick');

                // Filter: Must have a name and either a link or be a valid card
                // We exclude the 'Support', 'Close', and 'Version' text
                const isJunk = /Support|Version|Close|Discord|Telegram|PH Radio|Stream Player|18\+|v1\./i.test(name);
                
                if (name && name.length > 1 && !isJunk) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: img || null,
                        category: "LIVE",
                        websiteUrl: link && link.startsWith('http') ? link : null,
                        directUrl: null
                    };
                }
                return null;
            }).filter(x => x !== null && x.name !== "");
        });

        // Deduplicate: Sometimes the scraper finds the same card twice
        const uniqueChannels = Array.from(new Map(channels.map(item => [item.name, item])).values());

        console.log(`Found ${uniqueChannels.length} unique channels.`);
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

app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url || url === "null") return res.json({ error: "Invalid URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
        await new Promise(r => setTimeout(r, 10000)); // Longer wait for DRM channels
        res.json(streamData);
    } catch (e) {
        res.json({ error: "Resolution failed" });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Proxy is live. Check /channels"));
app.listen(port, "0.0.0.0", () => console.log(`Proxy running on port ${port}`));
