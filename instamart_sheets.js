const puppeteer = require('puppeteer');
const fs = require('fs');
const { google } = require('googleapis');

// Clean price string
function cleanPrice(text) {
    if (!text) return "NA";
    return text.replace(/[^\d]/g, '');
}

// Random delay helper
function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sleep helper
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Write to Google Sheet
async function writeToGoogleSheet(data) {
    const auth = new google.auth.GoogleAuth({
        keyFile: "./credentials.json", // Path to your Google service account credentials
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "17CaPQYQIpC5wG16lYWHRbCy04eRzYCjfK0a-wBM2z2c";
    const sheetName = "Instamart";

    try {
        // Clear existing data in the Instamart tab
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!A1:Z`,
        });
        console.log("Cleared Instamart tab.");

        // Prepare data for Google Sheet
        const header = ["name", "unit", "current_price", "original_price", "discount"];
        const values = [header, ...data.map(p => [
            p.name,
            p.unit,
            p.current_price,
            p.original_price,
            p.discount
        ])];

        // Write data to the sheet
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: "RAW",
            resource: { values },
        });
        console.log(`Wrote ${values.length - 1} products to Google Sheet (Instamart tab).`);
    } catch (err) {
        console.error("Google Sheet error:", err.message);
    }
}

// Function to inject and run the test script for lazy loading
async function runTestScript(page) {
    console.log("🔄 Injecting and running test script for lazy loading...");

    const result = await page.evaluate(async () => {
        const container = document.querySelector('div._2_95H.bottomOffsetPadBottom');
        if (!container) {
            console.log("❌ Container not found");
            return 0;
        }

        let prevCount = 0;
        let stableCount = 0;
        const maxStable = 5;

        while (stableCount < maxStable) {
            const cards = container.querySelectorAll('div[data-testid="default_container_ux4"]');
            const count = cards.length;
            console.log(`🔹 Product count: ${count}, diff: ${count - prevCount}`);

            if (count === prevCount) {
                stableCount++;
            } else {
                stableCount = 0;
                prevCount = count;
            }

            container.scrollBy({ top: 800, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
        }

        console.log("✅ Finished scrolling. Total products:", prevCount);
        return prevCount;
    });

    console.log(`✅ Test script completed. Loaded ${result} products.`);
    return result;
}

// Main scraper function
async function scrapeInstamartPepe(outputFile = "instamart.csv") {
    const url = "https://www.swiggy.com/instamart/collection-listing?collectionId=106463&custom_back=true&brand=Pepe%20Jeans";

    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1440, height: 900 },
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });
    const page = await browser.newPage();

    // Set headers to mimic real browser
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    try {
        console.log("🚀 Navigating to Pepe Jeans Instamart collection...");
        await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
        await sleep(random(3000, 5000));

        // Handle pincode/location popup with retries
        for (let retry = 0; retry < 2; retry++) {
            try {
                const locPopup = await page.$('div[data-testid="search-location"]');
                if (locPopup) {
                    console.log("📍 Handling location popup...");
                    await locPopup.click();
                    await page.waitForSelector('input._1wkJd', { timeout: 10000 });
                    await page.type('input._1wkJd', '560012');
                    await page.keyboard.press("Enter");
                    await sleep(random(5000, 7000));
                    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
                    await sleep(random(3000, 5000));
                }
                break;
            } catch (e) {
                console.log(`📍 Retry ${retry + 1} for location: ${e.message}`);
                await sleep(2000);
            }
        }

        // Wait for initial products
        try {
            await page.waitForSelector('div[data-testid^="default_container_ux4"]', { timeout: 30000 });
            console.log("✅ Initial products loaded");
        } catch (e) {
            console.error("❌ Initial products not loaded:", e.message);
            const title = await page.title();
            const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 200));
            console.log(`🔍 Debug - Title: ${title}\nBody snippet: ${bodySnippet}`);
            await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
            console.log("📸 Debug screenshot saved as 'debug_screenshot.png'");
            return;
        }

        // Run the test script to handle lazy loading
        const totalProducts = await runTestScript(page);
        if (totalProducts === 0) {
            console.error("❌ Test script failed to load products.");
            return;
        }

        // Verify final product count
        const finalCount = await page.$$eval('div[data-testid^="default_container_ux4"]', els => els.length);
        console.log(`✅ Final product count after test script: ${finalCount}`);

        // Extract product data
        const products = await page.$$eval('div[data-testid^="default_container_ux4"]', cards => {
            const clean = text => text ? text.replace(/[^\d]/g, '') : "NA";
            const seen = new Set();
            const result = [];

            cards.forEach(card => {
                const nameEl = card.querySelector('div.byAowK._1sPB0, div.novMV, h4, a');
                const unitEl = card.querySelector('div[aria-label*="Small"], div[aria-label*="Medium"], div[aria-label*="Large"], div._1QFfK');
                const currentPriceEl = card.querySelector('div[data-testid="item-offer-price"], div._1kMS');
                const originalPriceEl = card.querySelector('div[data-testid="item-mrp-price"], div._3M7u');
                const discountEl = card.querySelector('div[data-testid="offer-text"], div._2X1S');

                const name = nameEl ? nameEl.innerText.trim() : "NA";
                if (name === "NA" || seen.has(name)) return;
                seen.add(name);

                result.push({
                    name,
                    unit: unitEl ? unitEl.innerText.trim() : "NA",
                    current_price: clean(currentPriceEl?.innerText),
                    original_price: clean(originalPriceEl?.innerText),
                    discount: discountEl ? discountEl.innerText.trim() : "NA"
                });
            });

            return result;
        });

        // Save to CSV
        const keys = ["name", "unit", "current_price", "original_price", "discount"];
        const csvLines = [keys.join(",")];
        products.forEach(p => {
            csvLines.push(keys.map(k => `"${(p[k] || '').replace(/"/g, '""')}"`).join(","));
        });
        fs.writeFileSync(outputFile, csvLines.join("\n"));
        console.log(`\n✅ Saved ${products.length} unique products to ${outputFile}`);

        // Write to Google Sheet
        await writeToGoogleSheet(products);

    } catch (err) {
        console.error("❌ Scraper failed:", err.message);
        await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
        console.log("📸 Debug screenshot saved as 'debug_screenshot.png'");
    } finally {
        await browser.close();
    }
}

// Run scraper
scrapeInstamartPepe();