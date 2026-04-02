const express = require('express');
const { chromium } = require('playwright');
const app = express();

// Use the door Railway gives us
const port = process.env.PORT || 3000;

async function findStreamDetails(targetUrl) {
    console.log(`--- Searching: ${targetUrl} ---`);
    
    // Launch a "Lite" version of the browser
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 } 
    });
    
    const page = await context.newPage();

    let streamData = { videoUrl: null, licenseUrl: null, headers: {} };

    // This "sniffs" the air for video links
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mpd')) {
            streamData.videoUrl = url;
        }
        if (url.includes('widevine') || url.includes('license') || url.includes('clearkey')) {
            streamData.licenseUrl = url;
            streamData.headers = request.headers();
        }
    });

    try {
        // Step 1: Go to the site but don't wait for images/ads (saves RAM)
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Step 2: Click the player to wake it up
        await page.mouse.click(640, 360); 
        
        // Step 3: Wait just 5 seconds for the link to appear
        await new Promise(resolve => setTimeout(resolve, 5000)); 
        
    } catch (e) {
        console.log("Search took too long: ", e.message);
    } finally {
        // Step 4: Kill the browser immediately to free up memory
        await browser.close();
        console.log("--- Search Done ---");
    }

    return streamData;
}

// --- THE BROADCAST TOWER ---

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.json({ error: "Please provide a ?url= link" });
    }

    try {
        const result = await findStreamDetails(url);
        res.json(result); 
    } catch (err) {
        res.status(500).json({ error: "Station overloaded. Try again." });
    }
});

// Wake up the station
app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Station is LIVE on port ${port}`);
});
