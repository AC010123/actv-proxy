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
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        await page.route('**/*.{png,jpg,jpeg,css,svg,woff}', route => route.abort());
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        const channels = await page.evaluate((baseUrl) => {
            const elements = Array.from(document.querySelectorAll('a, [onclick], .grid-item'));
            
            const filtered = elements.map((el) => {
                const name = el.innerText.trim();
                const img = el.querySelector('img')?.src || null;
                const onclick = el.getAttribute('onclick') || "";

                const isJunk = /Contact|Support|Version|Close|Discord|Telegram|Update|v1\./i.test(name);
                if (isJunk || !name || name.length < 2) return null;

                const match = onclick.match(/'([^']+)'/);
                const slug = match ? match[1] : null;

                return {
                    name: name,
                    logoUrl: img,
                    category: "LIVE",
                    websiteUrl: slug ? `${baseUrl}play/${slug}` : null
                };
            }).filter(item => item !== null && item.websiteUrl !== null);

            return Array.from(new Map(filtered.map(c => [c.name, c])).values());
        }, TARGET_SITE);

        const finalChannels = channels.map((c, i) => ({ id: String(i + 1), ...c }));
        console.log(`Successfully indexed ${finalChannels.length} clean channels.`);
        
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
        // Use a realistic user agent to prevent being blocked by the player provider
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        let streamData = { videoUrl: null, licenseUrl: null };

        // IMPROVED LISTENER: Prioritize Master Playlists and block segments
        page.on('request', r => {
            const u = r.url();
            
            // Look for HLS (.m3u8) or DASH (.mpd)
            // We exclude 'chunk' or 'segment' to ensure we get the main stream URL
            if ((u.includes('.m3u8') || u.includes('.mpd')) && !u.includes('chunk') && !u.includes('segment')) {
                streamData.videoUrl = u;
            }

            // Look for DRM Licenses (Widevine/ClearKey)
            if (u.includes('widevine') || u.includes('license') || u.includes('clearkey') || u.includes('drm')) {
                streamData.licenseUrl = u;
            }
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        
        // Wait longer for the video player to perform the DRM handshake
        await new Promise(r => setTimeout(r, 12000)); 
        
        console.log(`Resolved: ${streamData.videoUrl ? 'Success' : 'Failed'}`);
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
