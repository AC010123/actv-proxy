const { chromium } = require('playwright');
const express = require('express');
const app = express();

// This is the "Brain" that finds the secret TV links
async function findStreamDetails(targetUrl) {
    const browser = await chromium.launch({ 
        headless: true, // Runs invisibly
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    let streamData = { url: null, license: null, headers: {} };

    // This "sniffs" the website traffic as it loads
    page.on('request', request => {
        const url = request.url();
        
        // Look for the Video Link (Manifest)
        if (url.includes('.m3u8') || url.includes('.mpd')) {
            streamData.url = url;
        }
        
        // Look for the "Digital Key" (DRM License)
        if (url.includes('widevine') || url.includes('license') || url.includes('clearkey')) {
            streamData.license = url;
            streamData.headers = request.headers(); // Save the "ID card" needed for the key
        }
    });

    try {
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
        // Wait 5 seconds to make sure the player actually starts
        await page.waitForTimeout(5000); 
    } catch (e) {
        console.log("Error loading page: ", e);
    } finally {
        await browser.close();
    }

    return streamData;
}

// This creates the "Phone Line" for your Android TV app to call
app.get('/resolve', async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).send({ error: "Missing URL" });

    console.log("Searching for links on:", target);
    const results = await findStreamDetails(target);
    res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Middleman is running on port ${PORT}`));