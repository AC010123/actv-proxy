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

// --- ENDPOINT 1: THE LIST ---
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();
        await page.goto('https://iyadtv.pages.dev/', { 
            waitUntil: 'networkidle', 
            timeout: 60000 
        });

        await page.waitForSelector('.channel-card', { timeout: 15000 });

        const channels = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.channel-card')).map((card, index) => {
                const name = card.getAttribute('aria-label') || "Unknown";
                const img = card.querySelector('.channel-card-logo');
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: img ? img.src : "", 
                    websiteUrl: `https://iyadtv.pages.dev/watch?v=${encodeURIComponent(name)}`
                };
            });
        });

        console.log(`Successfully scraped ${channels.length} channels.`);
        res.json(channels);
    } catch (error) {
        console.error("Scraping Error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ENDPOINT 2: THE REAL RESOLVER (The Sniffer) ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        console.log(`Resolving stream for: ${targetUrl}`);
        browser = await chromium.launch(launchOptions);
        const page = await browser.newPage();

        // 1. Create a promise that triggers when an .m3u8 link is found in the network
        const streamPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Stream timeout")), 25000);
            
            page.on('response', response => {
                const url = response.url();
                if (url.includes('.m3u8')) {
                    clearTimeout(timeout);
                    resolve(url);
                }
            });
        });

        // 2. Navigate to the watch page
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 3. Try to click a play button if one exists (optional but helps some sites)
        try {
            await page.click('video', { timeout: 2000 });
        } catch (e) { /* ignore if no video element found yet */ }

        // 4. Wait for the sniffer to find the link
        const finalStreamUrl = await streamPromise;

        console.log(`Found stream: ${finalStreamUrl}`);
        res.json({
            success: true,
            url: finalStreamUrl
        });

    } catch (error) {
        console.error("Resolution Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Backend Active on Port ${PORT}`));
