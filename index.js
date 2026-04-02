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
        console.log(`Starting Multi-Step Sniff for: ${targetUrl}`);
        browser = await chromium.launch(launchOptions);
        
        const page = await browser.newPage({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        let foundUrl = null;

        // Sniffer is active throughout the session
        page.on('response', response => {
            const url = response.url();
            if (url.includes('.m3u8') || url.includes('.mpd')) {
                // Filter out common analytics/ad tracking m3u8s if they exist
                if (!url.includes('analytics') && !url.includes('telemetry')) {
                    foundUrl = url;
                }
            }
        });

        // STEP 1: Load the initial watch page
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // STEP 2: Trigger the Popup
        // We click the center where the "Watch" or "Play" button usually sits
        console.log("Triggering channel popup...");
        await page.mouse.click(640, 360); 
        await new Promise(r => setTimeout(r, 2500));

        // STEP 3: Select the 1st Stream Option
        // We look for "Server 1", "Stream 1", or simply buttons containing "1"
        const clickResult = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, a, li, span'));
            const firstStream = elements.find(el => {
                const text = el.innerText.toLowerCase();
                return (text.includes('server 1') || text.includes('stream 1') || text === '1');
            });

            if (firstStream) {
                firstStream.click();
                return "Clicked Stream 1";
            }
            return "No specific stream button found";
        });
        
        console.log(`Selection Step: ${clickResult}`);

        // STEP 4: Final wait for the sniffer to catch the hidden link
        // We give it up to 20 seconds because of the multi-click nature
        for (let i = 0; i < 20; i++) {
            if (foundUrl) break;
            
            // Emergency click at the 7-second mark if nothing is happening
            if (i === 7) {
                console.log("Sending emergency interaction click...");
                await page.mouse.click(640, 360);
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (foundUrl) {
            console.log(`Success! Stream caught: ${foundUrl}`);
            res.json({ success: true, url: foundUrl });
        } else {
            throw new Error("Could not find a valid stream link after navigating the popup.");
        }

    } catch (error) {
        console.error("Sniffer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Backend (Multi-Step Mode) Active on Port ${PORT}`));
