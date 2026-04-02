const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// 1. THE AUTOMATIC CHANNEL SCRAPER
async function fetchLiveChannels() {
    console.log("--- Scraping fresh list from iyadtv ---");
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    
    try {
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 30000 });

        // This scans the website for all links (<a> tags) that contain channel info
        const channels = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('a')); 
            
            return cards.map((card, index) => {
                const name = card.innerText.trim();
                const img = card.querySelector('img')?.src;
                const url = card.href;

                // Only include if there is a name and a link
                if (name && url && !url.includes('javascript:')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: img || null,
                        category: "LIVE",
                        websiteUrl: url,
                        directUrl: null
                    };
                }
                return null;
            }).filter(item => item !== null);
        });

        console.log(`Successfully indexed ${channels.length} channels.`);
        return channels;
    } catch (e) {
        console.error("Scrape Error:", e.message);
        return [];
    } finally {
        await browser.close();
    }
}

// 2. THE CHANNELS ROUTE
app.get('/channels', async (req, res) => {
    try {
        const list = await fetchLiveChannels();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: "Failed to scrape channels" });
    }
});

// 3. THE RESOLVER (Ghost Browser for stream links)
async function findStreamDetails(targetUrl) {
    console.log(`--- Resolving Stream: ${targetUrl} ---`);
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    let streamData = { videoUrl: null, licenseUrl: null, headers: {} };

    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mpd')) streamData.videoUrl = url;
        if (url.includes('widevine') || url.includes('license')) {
            streamData.licenseUrl = url;
            streamData.headers = request.headers();
        }
    });

    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(r => setTimeout(r, 5000)); 
    } catch (e) {
        console.log("Resolve Timeout:", e.message);
    } finally {
        await browser.close();
    }
    return streamData;
}

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ error: "No URL" });
    const result = await findStreamDetails(url);
    res.json(result);
});

app.get('/', (req, res) => res.send("ACtv Station is Awake and Online!"));

app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Station LIVE on port ${port}`);
});
