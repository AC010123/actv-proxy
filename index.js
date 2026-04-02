const express = require('express');
const { chromium } = require('playwright');
const app = express();

// This tells Railway which "door" to use to talk to the internet
const port = process.env.PORT || 3000;

async function findStreamDetails(targetUrl) {
    console.log(`--- Starting Search for: ${targetUrl} ---`);
    
    // Launch the "Ghost Browser"
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 } 
    });
    
    const page = await context.newPage();

    // Stealth Mode: Makes the website think we are a real person
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    let streamData = { videoUrl: null, licenseUrl: null, headers: {} };

    // This "sniffs" the internet air to find the video links
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mpd')) {
            console.log("FOUND VIDEO LINK:", url);
            streamData.videoUrl = url;
        }
        if (url.includes('widevine') || url.includes('license') || url.includes('clearkey')) {
            console.log("FOUND LICENSE KEY:", url);
            streamData.licenseUrl = url;
            streamData.headers = request.headers();
        }
    });

    try {
        // We give the website 30 seconds to show us the video
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Click the middle of the screen to start the player automatically
        await page.mouse.click(640, 360); 
        
        // Wait a few seconds for the "handshake" to finish
        await new Promise(resolve => setTimeout(resolve, 8000)); 
        
    } catch (e) {
        console.log("Search timed out or failed: ", e.message);
    } finally {
        await browser.close();
        console.log("--- Search Finished ---");
    }

    return streamData;
}

// --- THE BROADCAST TOWER ---

// This is what your Android TV app will "call"
app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.json({ error: "Please provide a ?url= link" });
    }

    try {
        const result = await findStreamDetails(url);
        res.json(result); // Sends the video link back to your TV
    } catch (err) {
        res.status(500).json({ error: "Server got tired. Try again." });
    }
});

// Start the station
app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Station is LIVE on port ${port}`);
});
