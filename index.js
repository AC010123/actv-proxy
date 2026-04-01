const { chromium } = require('playwright');
const express = require('express');
const app = express();

// This is the "Brain" that finds the secret TV links
async function findStreamDetails(targetUrl) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    let streamData = { url: null, license: null, headers: {} };

    // Listen for requests
    page.on('request', request => {
        const url = request.url();
        
        // Log what we find to Railway logs so you can see it!
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
        // Increase timeout to 60s for slow TV sites
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // --- NEW: Trigger the player ---
        // Some sites need a small scroll or click to start the player
        await page.mouse.wheel(0, 500); 
        
        // Wait 10 seconds (instead of 5) to give the player time to 'handshake'
        await new Promise(resolve => setTimeout(resolve, 10000)); 
        
    } catch (e) {
        console.log("Error loading page: ", e.message);
    } finally {
        await browser.close();
    }

    return streamData;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Middleman is running on port ${PORT}`));
