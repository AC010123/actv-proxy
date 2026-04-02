const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing URL parameter" });

    let browser;
    try {
        // 1. Launch browser with specific flags to avoid detection
        browser = await chromium.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        // KILL POPUPS: If the site tries to open a new tab/window, close it instantly
        context.on('page', async popup => {
            await popup.close();
        });

        const page = await context.newPage();
        let finalStream = { videoUrl: null, licenseUrl: null };

        // 2. Network Listener: Capture the .mpd or .m3u8 link as it flies by
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.mpd') || url.includes('.m3u8')) {
                // Ignore small segments/chunks, we want the main manifest
                if (!url.includes('chunk') && !url.includes('fragment') && !url.includes('segment')) {
                    finalStream.videoUrl = url;
                }
            }
            // Capture Widevine DRM license URL if it exists
            if (url.includes('widevine') || url.includes('license')) {
                finalStream.licenseUrl = url;
            }
        });

        // 3. Navigate to the channel page
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 4. THE FIX: Handle the "Source Selection" box
        try {
            // Wait for the box to appear (give it 5 seconds max)
            const selectionBox = '#source-selection-box';
            await page.waitForSelector(selectionBox, { timeout: 5000 });

            // Find all buttons inside the list that ARE NOT the 'Close' button
            // CSS: Select buttons that do NOT have the class 'cancel_btn'
            const buttons = await page.locator('#source-buttons-list button:not(.cancel_btn)');
            
            if ((await buttons.count()) > 0) {
                console.log("Source selection found. Clicking the first stream...");
                // Click the first button (Stream 1)
                await buttons.first().click();
            }
        } catch (e) {
            console.log("No selection box appeared, checking network logs directly...");
        }

        // 5. Wait for the player to initialize after the click
        await page.waitForTimeout(6000); 

        if (finalStream.videoUrl) {
            res.json({
                success: true,
                ...finalStream
            });
        } else {
            res.status(404).json({ success: false, error: "Manifest URL not found after selection." });
        }

    } catch (error) {
        console.error("Scraper Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Resolver running on port ${PORT}`);
});
