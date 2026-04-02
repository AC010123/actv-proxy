const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// --- ENDPOINT 1: GET CHANNEL LIST ---
// This populates your Android TV grid with names and logos
app.get('/channels', async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.goto('https://iyadtv.pages.dev/', { waitUntil: 'networkidle' });

        const channels = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('a[href*="/play/"]'));
            return items.map((item, index) => {
                const name = item.querySelector('h3')?.innerText || "Unknown";
                const logo = item.querySelector('img')?.src || "";
                const slug = item.getAttribute('href').split('/').pop();
                return {
                    id: (index + 1).toString(),
                    name: name,
                    logoUrl: logo,
                    category: "LIVE",
                    websiteUrl: `https://iyadtv.pages.dev/play/${slug}`,
                    directUrl: null // We resolve this later via /resolve
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

// --- ENDPOINT 2: RESOLVE SPECIFIC STREAM ---
// This handles the "Source Selection" box and returns the actual video link
app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing URL parameter" });

    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        // Auto-close any ad popups
        context.on('page', async popup => { await popup.close(); });

        const page = await context.newPage();
        let finalStream = { videoUrl: null };

        // Catch the .mpd link when it appears in the network
        page.on('request', request => {
            const url = request.url();
            if ((url.includes('.mpd') || url.includes('.m3u8')) && !url.includes('chunk')) {
                finalStream.videoUrl = url;
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // THE FIX: Click the button in that "Select Stream" box
        try {
            const selectionBox = '#source-selection-box';
            await page.waitForSelector(selectionBox, { timeout: 5000 });
            
            // Target the buttons that aren't the "Close" button
            const buttons = page.locator('#source-buttons-list button:not(.cancel_btn)');
            if (await buttons.count() > 0) {
                await buttons.first().click();
            }
        } catch (e) {
            console.log("No selection box found, checking logs directly...");
        }

        // Wait for the stream to initialize
        await page.waitForTimeout(6000);

        if (finalStream.videoUrl) {
            res.json({ success: true, videoUrl: finalStream.videoUrl });
        } else {
            res.status(404).json({ success: false, error: "Stream not found" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
