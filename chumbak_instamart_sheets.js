const puppeteer = require('puppeteer');
const fs = require('fs');
const { google } = require('googleapis');

// ---------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------
function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------
//  Google-Sheet writer
// ---------------------------------------------------------------
async function writeToGoogleSheet(data) {
    const auth = new google.auth.GoogleAuth({
        keyFile: "./credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = "1HVALKEqNso9dXiy-qC4NyXhDFAgi66KDPuRepmEjVX0";
    const sheetName = "Instamart";

    try {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!A1:Z`,
        });
        console.log("Cleared Instamart tab.");

        const header = ["name", "unit", "current_price", "original_price", "discount"];
        const values = [
            header,
            ...data.map(p => [
                p.name,
                p.unit,
                p.current_price,
                p.original_price,
                p.discount,
            ]),
        ];

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

// ---------------------------------------------------------------
//  Lazy-load helper — REAL SCROLL CONTAINER
// ---------------------------------------------------------------
async function runTestScript(page) {
    console.log("Injecting lazy load script...");

    const result = await page.evaluate(async () => {
        const container = document.querySelector('div._1x1dT') || document.body;
        if (!container) return 0;

        let prevCount = 0;
        let stableCount = 0;
        const maxStable = 6;

        while (stableCount < maxStable) {
            const cards = container.querySelectorAll('div._3Rr1X');
            const count = cards.length;

            if (count === prevCount) stableCount++;
            else { stableCount = 0; prevCount = count; }

            container.scrollBy({ top: 1500, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 3000));
        }
        return prevCount;
    });

    console.log(`Lazy load completed. Loaded ${result} products.`);
    return result;
}

// ---------------------------------------------------------------
//  MAIN SCRAPER – BOTH COLLECTIONS
// ---------------------------------------------------------------
async function scrapeInstamartChumbak(outputFile = "instamart_chumbak.csv") {
    const collections = [
        {
            name: "Chumbak",
            url: "https://www.swiggy.com/instamart/collection-listing?collectionId=106463&custom_back=true&brand=CHUMBAK"
        },
        {
            name: "Teal By Chumbak",
            url: "https://www.swiggy.com/instamart/collection-listing?collectionId=106463&custom_back=true&brand=Teal%20By%20Chumbak"
        }
    ];

    const browser = await puppeteer.launch({
        headless: true, // Set to true in production
        defaultViewport: { width: 1440, height: 900 },
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    const handleLocationPopup = async () => {
        for (let retry = 0; retry < 2; retry++) {
            try {
                const locPopup = await page.$('div[data-testid="search-location"]');
                if (locPopup) {
                    console.log("Handling location popup...");
                    await locPopup.click();
                    await page.waitForSelector('input._1wkJd', { timeout: 10000 });
                    await page.type('input._1wkJd', '560012');
                    await page.keyboard.press("Enter");
                    await sleep(random(5000, 7000));
                }
                return true;
            } catch (e) {
                console.log(`Retry ${retry + 1} for location: ${e.message}`);
                await sleep(2000);
            }
        }
        return false;
    };

    // ----- EXTRACT USING YOUR REAL HTML -----
    const extractProducts = async () => {
        const products = await page.$$eval('div._3Rr1X', cards => {
            const seen = new Set();
            const result = [];

            cards.forEach(card => {
                const nameEl = card.querySelector('div.sc-gEvEer.bvSpbA._1lbNR');
                const priceEl = card.querySelector('div.sc-gEvEer.iQcBUp._2jn41');
                const mrpEl = card.querySelector('div.sc-gEvEer.fULQHN._3eAjW._2jn41');
                const unitEl = card.querySelector('div.sc-gEvEer.bCqPoH._3wq_F');

                const name = nameEl?.innerText.trim() || "NA";
                if (name === "NA" || seen.has(name)) return;
                seen.add(name);

                const current_price = priceEl?.innerText.trim() || "NA";
                const original_price = mrpEl?.innerText.trim() || "NA";
                const unit = unitEl?.innerText.trim() || "NA";

                // Calculate discount
                const discount = (() => {
                    if (current_price === "NA" || original_price === "NA") return "NA";
                    const curr = parseInt(current_price);
                    const orig = parseInt(original_price);
                    if (orig <= curr || orig === 0) return "NA";
                    return `${Math.round(((orig - curr) / orig) * 100)}% OFF`;
                })();

                result.push({ name, unit, current_price, original_price, discount });
            });
            return result;
        });
        return products;
    };

    const allProducts = [];
    const seenNames = new Set();

    try {
        for (const col of collections) {
            console.log(`\n=== Scraping ${col.name} ===`);
            await page.goto(col.url, { waitUntil: "networkidle2", timeout: 120000 });
            await sleep(random(3000, 5000));

            await handleLocationPopup();

            try {
                await page.waitForSelector('div._3Rr1X', { timeout: 30000 });
                console.log("Initial products loaded");
            } catch (e) {
                console.error("Initial products not loaded:", e.message);
                await page.screenshot({ path: `debug_${col.name.replace(/\s+/g, '_')}.png`, fullPage: true });
                continue;
            }

            const loaded = await runTestScript(page);
            if (loaded === 0) continue;

            const finalCount = await page.$$eval('div._3Rr1X', els => els.length);
            console.log(`Final product count: ${finalCount}`);

            const products = await extractProducts();
            console.log(`Extracted ${products.length} unique items from ${col.name}`);

            for (const p of products) {
                if (!seenNames.has(p.name)) {
                    seenNames.add(p.name);
                    allProducts.push(p);
                }
            }
        }

        // ----- WRITE CSV -----
        const keys = ["name", "unit", "current_price", "original_price", "discount"];
        const csvLines = [keys.join(",")];
        allProducts.forEach(p => {
            csvLines.push(keys.map(k => `"${(p[k] || '').replace(/"/g, '""')}"`).join(","));
        });
        fs.writeFileSync(outputFile, csvLines.join("\n"));
        console.log(`\nSaved ${allProducts.length} unique products to ${outputFile}`);

        // ----- WRITE GOOGLE SHEET -----
        await writeToGoogleSheet(allProducts);

    } catch (err) {
        console.error("Fatal error:", err);
        await page.screenshot({ path: 'debug_fatal.png', fullPage: true });
    } finally {
        await browser.close();
    }
}

// -----------------------------------------------------------------
scrapeInstamartChumbak();