const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

let cachedChannels = null;
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; 

async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Refreshing ACtv Channel List ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ] 
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });

        const page = await context.newPage();
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        // NEW SELECTOR: Wait for the specific class seen in your HTML snippet
        try {
            await page.waitForSelector('.channel-card', { timeout: 15000 });
        } catch (e) {
            console.log("Could not find .channel-card. Site might be slow or layout changed.");
        }

        const channels = await page.evaluate((baseUrl) => {
            // Select all elements with the 'channel-card' class
            const cards = Array.from(document.querySelectorAll('.channel-card'));
            
            return cards.map((el) => {
                // The name is now stored in 'aria-label' or the inner div
                const name = el.getAttribute('aria-label') || el.innerText?.trim();
                const img = el.querySelector('img')?.src || null;
                
                // We generate the slug from the name to match the site's URL structure
                // Usually names like "ABC Australia" become "abc-australia"
                const slug = name.toLowerCase()
                                 .replace(/[^a-z0-9]+/g, '-')
                                 .replace(/(^-|-$)/g, '');

                if (!name || name.length < 2) return null;

                return {
                    name: name,
                    logoUrl: img,
                    category: "LIVE",
                    websiteUrl: `${baseUrl}play/${slug}`,
                    directUrl: null
                };
            }).filter(Boolean);
        }, TARGET_SITE);

        if (channels.length === 0) {
            console.log("Scraper found 0 channels. Check selectors.");
            return cachedChannels || [];
        }

        const finalChannels = channels.map((c, i) => ({ id: String(i + 1), ...c }));
        
        console.log(`Successfully indexed ${finalChannels.length} channels.`);
        cachedChannels = finalChannels;
        lastFetchTime = Date.now();
        return finalChannels;

    } catch (e) {
        console.error("Scrape Error:", e.message);
        return cachedChannels || [];
    } finally {
        if (browser) await browser.close();
    }
}

app.get('/channels', async (req, res) => {
    const list = await fetchLiveChannels();
    res.json(list);
});

app.get('/resolve', async (req, res) => {
    const url = req.query.url;
    if (!url || url === "null") return res.status(400).json({ error: "Invalid URL" });
    
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        let streamData = { videoUrl: null, licenseUrl: null };

        page.on('request', r => {
            const u = r.url();
            if ((u.includes('.m3u8') || u.includes('.mpd')) && !u.includes('chunk')) {
                streamData.videoUrl = u;
            }
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

        // Handle the popup button
        try {
            // Target the pink/red buttons seen in your screenshot
            const streamButton = await page.waitForSelector('button:has-text("TV5"), .stream-option, [role="button"]', { timeout: 10000 });
            if (streamButton) {
                await streamButton.click();
            }
        } catch (err) {
            console.log("No popup or click failed, waiting for auto-load...");
        }

        await new Promise(r => setTimeout(r, 12000)); 
        res.json(streamData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/', (req, res) => res.send("ACtv Backend: Online"));

app.listen(port, "0.0.0.0", () => {
    console.log(`ACtv Server running on port ${port}`);
});
