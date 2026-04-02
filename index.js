const express = require('express');
const { chromium } = require('playwright');
const app = express();

// Use the door Railway gives us
const port = process.env.PORT || 3000;

// 1. SIMPLE AWAKE TEST
// This lets us see if the station is on without using the heavy browser
app.get('/', (req, res) => {
    res.send("ACtv Station is Awake and Online!");
});

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

// 2. THE RESOLVER
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
    console.log(`LIVE on port ${port}`);
});
