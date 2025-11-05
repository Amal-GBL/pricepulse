const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const fs = require("fs");
const { google } = require("googleapis");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanPrice(priceStr) {
  if (!priceStr || priceStr === "NA") return "NA";
  return priceStr.replace(/[^\d]/g, "") || "NA";
}

// Write to Google Sheet
async function writeToGoogleSheet(products) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "./credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "17CaPQYQIpC5wG16lYWHRbCy04eRzYCjfK0a-wBM2z2c";
  const sheetName = "Zepto";

  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });
    console.log("Cleared Zepto tab.");

    const header = ["name", "unit", "current_price", "original_price", "discount"];
    const values = [header, ...products.map(p => [
      p.name,
      p.unit,
      p.current_price,
      p.original_price,
      p.discount
    ])];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      resource: { values },
    });
    console.log(`Wrote ${values.length - 1} products to Google Sheet (Zepto tab).`);
  } catch (err) {
    console.error("Google Sheet error:", err.message);
  }
}

// Search with retry
async function searchWithRetry(page, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Search attempt ${i + 1}...`);

      // Click search bar
      await page.waitForSelector("span[data-testid='searchBar']", { visible: true, timeout: 15000 });
      await page.click("span[data-testid='searchBar']");
      await sleep(2000);

      // Wait for input with partial placeholder match
      const searchInput = await page.waitForSelector("input[placeholder*='Search for']", { visible: true, timeout: 10000 });
      await searchInput.click({ clickCount: 3 });
      await searchInput.press('Backspace');
      await searchInput.type("pepe", { delay: 150 });
      await sleep(3000);

      // Check suggestions
      const suggestions = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll("li[id^=pepe]"));
        return items.map(item => ({
          id: item.id,
          text: item.innerText
        }));
      });
      console.log("Search suggestions found:", suggestions);

      if (suggestions.length > 0) {
        await page.click("li[id^=pepe]");
        await sleep(5000);
        return true;
      } else {
        console.log("No suggestions, pressing Enter...");
        await page.keyboard.press('Enter');
        await sleep(5000);
        return true;
      }
    } catch (e) {
      console.log(`Search attempt ${i + 1} failed:`, e.message);
      if (i === maxRetries - 1) throw e;
      await sleep(3000);
    }
  }
}

(async () => {
  console.log("Starting Zepto scraper...");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      '--disable-infobars',
      '--disable-extensions',
      '--disable-plugins-discovery',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-device-discovery-notifications',
    ],
    defaultViewport: null,
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();

  // SPOOF FINGERPRINTS
  await page.evaluateOnNewDocument(() => {
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [{}, {}, {}] });
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );

  try {
    console.log("1. Navigating to Zepto homepage...");
    await page.goto("https://www.zeptonow.com/", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(3000);

    // Step 1 — Set Location
    console.log("2. Selecting location...");
    try {
      await page.waitForSelector("button[aria-label='Select Location']", { timeout: 60000 });
      await page.click("button[aria-label='Select Location']");
      await sleep(2000);

      await page.waitForSelector("input[placeholder='Search a new address']", { timeout: 30000 });
      await page.type("input[placeholder='Search a new address']", "560012", { delay: 100 });
      await sleep(2000);

      await page.click("div.ck03O3 div.c4ZmYS");
      await sleep(2000);

      await page.click("button[data-testid='location-confirm-btn']");
      console.log("Location set to 560012");
      await sleep(3000);
    } catch (e) {
      console.log("Location selection failed. Proceeding anyway...");
    }

    // Step 2 — Search with retry
    console.log("3. Searching for 'Pepe Jeans'...");
    try {
      await searchWithRetry(page);
    } catch (e) {
      console.log("Search failed after retries:", e.message);
      await page.screenshot({ path: 'debug_search_error.png', fullPage: true });
      throw e;
    }

    // Step 3 — Scroll the CORRECT container (div.ci1XsL) — YOUR ORIGINAL LOGIC
    console.log("4. Scrolling inside product list to load all products...");
    const scrollSelector = "div.ci1XsL";
    try {
      await page.waitForSelector(scrollSelector, { timeout: 20000 });

      let lastProductCount = 0;
      let sameCount = 0;
      const maxSameCount = 8;
      let iteration = 0;

      while (sameCount < maxSameCount) {
        iteration++;

        await page.evaluate((selector) => {
          const container = document.querySelector(selector);
          if (container) {
            container.scrollBy(0, 800);
          }
        }, scrollSelector);

        await sleep(2000);

        const productCount = await page.evaluate(() => {
          return document.querySelectorAll("div[role='dialog'] div.SxLQB a").length;
        });

        console.log(`Iteration ${iteration}: Products loaded = ${productCount}`);

        if (productCount === lastProductCount) {
          sameCount++;
        } else {
          sameCount = 0;
          lastProductCount = productCount;
        }
      }

      console.log(`Finished scrolling - total products loaded: ${lastProductCount}`);
    } catch (e) {
      console.error("Scrolling failed:", e.message);
      await page.screenshot({ path: 'debug_scroll_error.png', fullPage: true });
      throw e;
    }

    // Step 4 — Scrape products — YOUR ORIGINAL LOGIC
    console.log("5. Scraping product details...");
    const products = await page.evaluate(() => {
      const cards = document.querySelectorAll("div[role='dialog'] div.SxLQB a");
      const items = [];
      cards.forEach((card) => {
        const nameEl = card.querySelector("[data-slot-id='ProductName'] span") || card.querySelector("span");
        const priceEl = card.querySelector("[data-slot-id='Price'] p.cGFDG0") || card.querySelector("p.cGFDG0");
        const mrpEl = card.querySelector("[data-slot-id='Price'] p.cFLlze") || card.querySelector("p.cFLlze");
        const discountEl = card.querySelector(".c5aJJW span:last-child");
        const unitEl = card.querySelector("[data-slot-id='PackSize'] span");

        const name = nameEl ? nameEl.innerText.trim() : "NA";

        if (name && /^pepe/i.test(name)) {
          items.push({
            name,
            unit: unitEl ? unitEl.innerText.trim() : "1 pc",
            current_price: priceEl ? priceEl.innerText.replace(/[^\d]/g, "") : "NA",
            original_price: mrpEl ? mrpEl.innerText.replace(/[^\d]/g, "") : "NA",
            discount: discountEl ? discountEl.innerText.trim() : "NA",
          });
        }
      });
      return items;
    });

    console.log(`Scraped ${products.length} Pepe products.`);

    // Step 5 — Save CSV
    if (products.length) {
      const header = ["name", "unit", "current_price", "original_price", "discount"];
      const csvData = [
        header.join(","),
        ...products.map((p) => header.map((h) => `"${(p[h] || "").replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      fs.writeFileSync("zepto_pepe.csv", csvData);
      console.log("Saved to zepto_pepe.csv");
    } else {
      console.log("No products found to save.");
    }

    // Step 6 — Write to Google Sheet
    if (products.length) {
      await writeToGoogleSheet(products);
    } else {
      console.log("No products to write to Google Sheet.");
    }

  } catch (err) {
    console.error("Scraper failed:", err.message);
    await page.screenshot({ path: 'debug_scraper_error.png', fullPage: true });
    console.log("Debug screenshot saved as 'debug_scraper_error.png'");
  } finally {
    console.log("Closing browser");
    await browser.close();
  }
})();