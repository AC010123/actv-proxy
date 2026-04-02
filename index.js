const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;

// 1. THE CHANNEL LIST (The "Menu")
// This is what your Android app downloads to show the list on screen.
app.get('/channels', (req, res) => {
    const channelList = [
        {
            "id": "1",
            "name": "HBO HD",
            "logoUrl": "https://example.com/hbo_logo.png",
            "category": "MOVIES",
            "websiteUrl": "https://example-stream-site.com/hbo", // MESSY LINK: Resolved by Railway
            "directUrl": null
        },
        {
            "id": "2",
            "name": "Sports Direct",
            "logoUrl": "https://example.com/sports_logo.png",
            "category": "SPORTS",
            "websiteUrl": null,
            "directUrl": "https://example.com/direct-stream.m3u8" // CLEAN LINK: Plays immediately
        }
    ];
    res.json(channelList);
});

// 2. AWAKE TEST
app.get('/', (req, res) => {
    res.send("ACtv Station is Awake and Online!");
});

// 3. THE RESOLVER (The "Ghost Browser")
async function findStreamDetails(targetUrl) {
    console.log(`--- Searching: ${targetUrl} ---`);
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();
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
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 5000)); 
    } catch (e) {
        console.log("Timeout: ", e.message);
    } finally {
        await browser.close();
    }
    return streamData;
}

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ error: "No URL provided" });
    try {
        const result = await findStreamDetails(url);
        res.json(result); 
    } catch (err) {
        res.status(500).json({ error: "Error" });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Station LIVE on port ${port}`);
});
