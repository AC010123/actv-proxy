process.setMaxListeners(30);
const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// Optimization: We only need this for fetching the list now
const launchOptions = {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};

// --- ENDPOINT 1: THE LIST (Keep this) ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
        
        // Block images and CSS to make this super fast
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'stylesheet'].includes(type)) return route.abort();
            route.continue();
        });

        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'networkidle', timeout: 30000 });
        
        const channels = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.channel-card')).map((card, index) => {
                const name = card.getAttribute('aria-label') || "Unknown";
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: card.querySelector('.channel-card-logo')?.src || "",
                    websiteUrl: `https://iyadtv.pages.dev/watch?v=${encodeURIComponent(name)}`
                };
            });
        });
        res.json(channels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: THE "DUMMY" RESOLVER ---
// We keep this endpoint so your Android app doesn't crash, 
// but we tell the app to handle resolution itself.
app.get('/resolve', (req, res) => {
    const targetUrl = req.query.url;
    res.json({
        success: true,
        useInternalSniffer: true, // A flag for your Kotlin code
        url: targetUrl
    });
});

app.listen(PORT, () => console.log(`ACtv Backend Active on Port ${PORT}`));
