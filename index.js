const express = require('express');
const { chromium } = require('playwright');
const app = express();

// Updated to 8080 to match the new Railway Variable
const port = process.env.PORT || 8080;

// 1. SIMPLE AWAKE TEST
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

// Final fix: Binding to 0.0.0.0 on port 8080
app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Station is Awake and Online on port ${port}`);
});
