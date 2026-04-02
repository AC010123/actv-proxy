const express = require('express');
const { chromium } = require('playwright');
const app = express();

const port = process.env.PORT || 8080;
const TARGET_SITE = "https://iyadtv.pages.dev/";

// 1. THE AUTOMATIC CHANNEL SCRAPER
async function fetchLiveChannels() {
    console.log("--- Starting Deep Scrape of iyadtv ---");
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    try {
        // 1. Visit the site and wait for it to be fully "still"
        await page.goto(TARGET_SITE, { waitUntil: 'networkidle', timeout: 60000 });

        // 2. Give it an extra 3 seconds just in case there's a fade-in animation
        await new Promise(r => setTimeout(r, 3000));

        // 3. Extract every link that looks like a channel
        const channels = await page.evaluate(() => {
            // Find all anchor tags
            const anchors = Array.from(document.querySelectorAll('a'));
            
            return anchors.map((a, index) => {
                const name = a.innerText.trim();
                const img = a.querySelector('img')?.src;
                const href = a.href;

                // FILTER: Only grab links that aren't social media or home buttons
                if (name.length > 1 && !href.includes('facebook') && !href.includes('twitter')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: img || null,
                        category: "LIVE",
                        websiteUrl: href,
                        directUrl: null
                    };
                }
                return null;
            }).filter(item => item !== null);
        });

        console.log(`Deep Scrape found ${channels.length} items.`);
        return channels;
    } catch (e) {
        console.error("Scrape Error Details:", e.message);
        return [];
    } finally {
        await browser.close();
    }
}
