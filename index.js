async function findStreamDetails(targetUrl) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    // 1. SET A REAL SCREEN SIZE (Crucial for TV sites)
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 } 
    });
    
    const page = await context.newPage();

    // 2. EXTRA STEALTH
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    let streamData = { url: null, license: null, headers: {} };

    // 3. SNIFF ALL TRAFFIC (Including hidden frames)
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mpd')) {
            console.log("!!! FOUND VIDEO !!!", url);
            streamData.url = url;
        }
        if (url.includes('widevine') || url.includes('license') || url.includes('clearkey')) {
            console.log("!!! FOUND LICENSE !!!", url);
            streamData.license = url;
            streamData.headers = request.headers();
        }
    });

    try {
        console.log(`Navigating to: ${targetUrl}`);
        // Wait for the page to at least load the skeleton
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 4. THE "GHOST CLICK"
        // Most players won't start until a user clicks. We click the middle of the screen.
        await page.mouse.click(640, 360); 
        console.log("Attempted click to start player...");

        // 5. THE LONG WAIT
        // Give it 15 seconds to finish the handshake
        await new Promise(resolve => setTimeout(resolve, 15000)); 
        
    } catch (e) {
        console.log("Error loading page: ", e.message);
    } finally {
        await browser.close();
    }

    return streamData;
}
