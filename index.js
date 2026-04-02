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

// --- ENDPOINT 2: THE UNIVERSAL RESOLVER ---
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("No URL provided");

    let browser;
    try {
        console.log(`Flexible Sniffing for: ${targetUrl}`);
        browser = await chromium.launch(launchOptions);
        
        const page = await browser.newPage({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        let foundUrl = null;

        // --- SMART SNIFFER LOGIC ---
        page.on('response', response => {
            const url = response.url();
            const contentType = response.headers()['content-type'] || '';
            
            // 1. Check by common streaming extensions
            const isStreamExtension = url.includes('.m3u8') || 
                                     url.includes('.mpd') || 
                                     url.includes('.m4s') || 
                                     url.includes('.ts');

            // 2. Check by Content-Type (covers hidden/renamed streams)
            const isStreamType = contentType.includes('mpegurl') || 
                                contentType.includes('dash+xml') || 
                                contentType.includes('video/mp2t');

            if ((isStreamExtension || isStreamType) && !url.includes('analytics')) {
                // If we find a master playlist or manifest, prioritize that
                if (url.includes('master') || url.includes('manifest')) {
                    foundUrl = url;
                } else if (!foundUrl) {
                    foundUrl = url;
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2500));

        // Click to trigger the player popup
        await page.mouse.click(640, 360); 
        await new Promise(r => setTimeout(r, 2500));

        // Click the first available stream source
        await page.evaluate(() => {
            const options = Array.from(document.querySelectorAll('a, button, li, .stream-link'));
            const first = options.find(el => {
                const text = el.innerText.trim().toLowerCase();
                return text === '1' || text.includes('server 1') || text.includes('stream 1');
            });
            if (first) first.click();
        });
        
        // Wait up to 20s for the player to negotiate the stream
        for (let i = 0; i < 20; i++) {
            if (foundUrl) break;
            if (i === 10) await page.mouse.click(640, 360); // Emergency re-click
            await new Promise(r => setTimeout(r, 1000));
        }

        if (foundUrl) {
            console.log(`Success! Flexible stream caught: ${foundUrl}`);
            res.json({ success: true, url: foundUrl });
        } else {
            throw new Error("No video stream (HLS/DASH/TS) detected.");
        }

    } catch (error) {
        console.error("Resolver Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`ACtv Backend (Universal Mode) Active on Port ${PORT}`));
