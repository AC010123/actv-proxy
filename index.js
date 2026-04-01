const { chromium } = require('playwright');
const express = require('express');
const app = express();

async function findStreamDetails(targetUrl) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    // STEALTH MODE: Makes the website think this is a real person, not a bot
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    let streamData = { url: null, license: null, headers: {} };

    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mpd')) {
            console.log("Found Video Link:", url);
            streamData.url = url;
        }
        if (url.includes('widevine') || url.includes('license') || url.includes('clearkey')) {
            console.log("Found License Link:", url);
            streamData.license = url;
            streamData.headers = request.headers();
        }
    });

    try {
        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // Scroll and wait to trigger the player
        await page.mouse.wheel(0, 500); 
        await new Promise(resolve => setTimeout(resolve, 12000)); // 12 seconds for safety
        
    } catch (e) {
        console.log("Error loading page: ", e.message);
    } finally {
        await browser.close();
    }

    return streamData;
}

// --- THIS PART WAS MISSING ---
// This is the route your Android app calls: /resolve?url=...
app.get('/resolve', async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).send({ error: "Missing URL" });

    console.log("--- New Request Received ---");
    const results = await findStreamDetails(target);
    
    // If we found nothing, let the app know
    if (!results.url) {
        console.log("FAILED: No stream links found.");
    } else {
        console.log("SUCCESS: Sending links to ACtv app.");
    }
    
    res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Middleman is running on port ${PORT}`));
