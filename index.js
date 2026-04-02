const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_WEBSITE = "https://example-iyadtv-site.com"; // <-- REPLACE WITH THE ACTUAL WEB URL

// 1. THE AUTOMATIC SCRAPER
async function fetchLiveChannels() {
    console.log("--- Scraping fresh channel list from website ---");
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    try {
        await page.goto(TARGET_WEBSITE, { waitUntil: 'networkidle', timeout: 30000 });

        // This part "grabs" the channels from the HTML. 
        // Note: We may need to tweak the '.channel-card' part to match the site's code.
        const channels = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.channel-item')); // Adjust selector
            return items.map((item, index) => ({
                id: String(index + 1),
                name: item.querySelector('.title')?.innerText || "Unknown",
                logoUrl: item.querySelector('img')?.src || null,
                category: "LIVE",
                websiteUrl: item.querySelector('a')?.href || null,
                directUrl: null
            }));
        });

        return channels;
    } catch (e) {
        console.error("Scrape failed:", e.message);
        return [];
    } finally {
        await browser.close();
    }
}

// 2. THE CHANNELS ROUTE (Now calls the Scraper)
app.get('/channels', async (req, res) => {
    const liveList = await fetchLiveChannels();
    if (liveList.length > 0) {
        res.json(liveList);
    } else {
        // Fallback if scraping fails
        res.json([{ id: "0", name: "Error loading list", category: "SYSTEM" }]);
    }
});

// 3. THE RESOLVER (Stays the same)
async function findStreamDetails(targetUrl) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    let streamData = { videoUrl: null, licenseUrl: null };

    page.on('request', r => {
        const u = r.url();
        if (u.includes('.m3u8') || u.includes('.mpd')) streamData.videoUrl = u;
        if (u.includes('widevine') || u.includes('license')) streamData.licenseUrl = u;
    });

    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(r => setTimeout(r, 5000)); 
    } finally {
        await browser.close();
    }
    return streamData;
}

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    const result = await findStreamDetails(url);
    res.json(result);
});

app.get('/', (req, res) => res.send("ACtv Station is Online!"));

app.listen(port, "0.0.0.0", () => console.log(`Live on ${port}`));
