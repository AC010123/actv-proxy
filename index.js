process.setMaxListeners(30);
const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

const launchOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
    ]
};

// --- ENDPOINT 1: THE LIST (Full Content for UI) ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();

        // We REMOVED the route blocking so images/fonts load correctly
        await page.goto('https://iyadtv.pages.dev/', { 
            waitUntil: 'networkidle', // Ensures images are finished loading
            timeout: 60000 
        });

        // Wait for the specific cards to appear
        await page.waitForSelector('.channel-card', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.channel-card')).map((card, index) => {
                const name = card.getAttribute('aria-label') || "Unknown";
                const img = card.querySelector('.channel-card-logo');
                return {
                    id: (index + 1).toString(),
                    name: name,
                    // Grabbing the actual source so your Android cards look good
                    logoUrl: img ? img.src : "", 
                    websiteUrl: `https://iyadtv.pages.dev/watch?v=${encodeURIComponent(name)}`
                };
            });
        });

        console.log(`Successfully scraped ${channels.length} channels with images.`);
        res.json(channels);
    } catch (error) {
        console.error("Scraping Error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: THE LIGHTWEIGHT RESOLVER ---
// This tells the Android app: "I've verified the intent, now use your Sniffer."
app.get('/resolve', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");
    
    res.json({
        success: true,
        useInternalSniffer: true,
        url: targetUrl
    });
});

app.listen(PORT, () => console.log(`ACtv Backend (Visual Mode) Active on Port ${PORT}`));
