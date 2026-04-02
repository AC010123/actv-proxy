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

    console.log("--- Starting Deep Filter Scrape ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Block non-essential assets
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        const channels = await page.evaluate(() => {
            // We target all anchor tags but apply strict validation
            const items = Array.from(document.querySelectorAll('a'));
            
            return items.map((item, index) => {
                const name = item.innerText.trim();
                const link = item.href;
                const img = item.querySelector('img')?.src || "";

                // --- THE CLEANER ---
                // 1. Ignore the specific sub-projects you just encountered
                const isUtility = /Radio|18\+|Stream Player|Support|Version|Close/i.test(name);
                
                // 2. Ignore social media and navigation anchors
                const isAnchorOnly = link.endsWith('#') || link.includes('javascript:');
                
                // 3. Real channels usually have an internal image path
                const hasChannelLogo = img.includes('images/') || img.includes('logo');

                if (name && !isUtility && !isAnchorOnly && link.startsWith('http')) {
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
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

// Keep your existing /resolve logic here...

app.get('/', (req, res) => res.send("ACtv Proxy: Active and Filtering"));
app.listen(port, "0.0.0.0", () => console.log(`Listening on ${port}`));
