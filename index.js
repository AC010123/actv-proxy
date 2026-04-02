// Replace your fetchLiveChannels function with this one
async function fetchLiveChannels() {
    if (cachedChannels && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedChannels;
    }

    console.log("--- Attempting Scrape ---");
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process' // Helps with memory on Railway
            ] 
        });
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Block everything except the HTML to save resources
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['document', 'script'].includes(type)) {
                route.continue();
            } else {
                route.abort();
            }
        });

        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const channels = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.map((a, index) => {
                const name = a.innerText.trim();
                const href = a.href;
                if (name.length > 1 && href.startsWith('http')) {
                    return {
                        id: String(index + 1),
                        name: name,
                        logoUrl: a.querySelector('img')?.src || null,
                        category: "LIVE",
                        websiteUrl: href,
                        directUrl: null
                    };
                }
                return null;
            }).filter(item => item !== null);
        });

        cachedChannels = channels;
        lastFetchTime = Date.now();
        console.log(`Scrape successful: found ${channels.length} channels`);
        return channels;

    } catch (e) {
        console.error("SCRAPE ERROR:", e.message);
        return cachedChannels || [];
    } finally {
        if (browser) await browser.close();
    }
}
