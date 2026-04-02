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
        console.log(`Sniffing: ${targetUrl}`);
        browser = await chromium.launch(launchOptions);
        
        // FIX: UserAgent must be set during newPage creation in Playwright
        const page = await browser.newPage({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
        });

        let foundUrl = null;

        // Start sniffing immediately
        page.on('response', response => {
            const url = response.url();
            if (url.includes('.m3u8') || url.includes('.mpd')) {
                foundUrl = url;
            }
        });

        // Navigate to the watch page
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // Wait 2 seconds for the site to stabilize before clicking
        await new Promise(r => setTimeout(r, 2000));
        
        // Force a click to trigger auto-play (bypasses browser autoplay restrictions)
        await page.mouse.click(400, 300); 
        console.log("Simulated click to trigger stream...");

        // Wait up to 15 seconds for the sniffer to catch the link
        for (let i = 0; i < 15; i++) {
            if (foundUrl) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (foundUrl) {
            console.log(`Stream caught: ${foundUrl}`);
            res.json({ success: true, url: foundUrl });
        } else {
            throw new Error("Could not find a valid stream link on this page.");
        }

    } catch (error) {
        console.error("Sniffer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Backend Active on Port ${PORT}`));
