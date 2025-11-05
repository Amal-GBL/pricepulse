const puppeteer = require("puppeteer");
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
    keyFile: "./credentials.json", // Path to your Google service account credentials
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1HVALKEqNso9dXiy-qC4NyXhDFAgi66KDPuRepmEjVX0";
  const sheetName = "Zepto";

  try {
    // Clear existing data in the Zepto tab
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });
    console.log("Cleared Zepto tab.");

    // Prepare data for Google Sheet
    const header = ["name", "unit", "current_price", "original_price", "discount"];
    const values = [header, ...products.map(p => [
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
    console.log(`Wrote ${values.length - 1} products to Google Sheet (Zepto tab).`);
  } catch (err) {
    console.error("Google Sheet error:", err.message);
  }
}

(async () => {
  console.log("🚀 Starting Zepto scraper...");

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
  );

  try {
    console.log("1️⃣ Navigating to Zepto homepage...");
    await page.goto("https://www.zeptonow.com/", { waitUntil: "networkidle2" });
    await sleep(2000);

    // Step 1 — Set Location
    console.log("2️⃣ Selecting location...");
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
      await sleep(2000);
    } catch (e) {
      console.log("Location selection failed or timed out. Proceeding anyway...");
    }

    // Step 2 — Search for Chumbak with better debugging
    console.log("3️⃣ Searching for 'Chumbak'...");
    try {
      // Click search bar
      await page.waitForSelector("span[data-testid='searchBar']", { visible: true, timeout: 10000 });
      await page.click("span[data-testid='searchBar']");
      await sleep(2000);

      // Type in search box
      const searchInput = await page.waitForSelector("input[placeholder^='Search for over 5000 products']", { visible: true, timeout: 10000 });
      await searchInput.type("chumbak", { delay: 100 });
      await sleep(3000);

      // Debug: Check what suggestions appeared
      const suggestions = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll("li[id^=chumbak]"));
        return items.map(item => ({
          id: item.id,
          text: item.innerText
        }));
      });
      console.log("🔍 Search suggestions found:", suggestions);

      if (suggestions.length === 0) {
        console.log("⚠️ No search suggestions found. Trying to press Enter instead...");
        await page.keyboard.press('Enter');
        await sleep(5000);
      } else {
        // Click first suggestion
        await page.click("li[id^=chumbak]");
        await sleep(5000);
      }
    } catch (e) {
      console.log("❌ Search failed:", e.message);
      await page.screenshot({ path: 'debug_search_error.png', fullPage: true });
    }

    // Step 3 — Scroll the CORRECT container (div.ci1XsL)
    console.log("4️⃣ Scrolling inside product list to load all products...");
    const scrollSelector = "div.ci1XsL";
    try {
      await page.waitForSelector(scrollSelector, { timeout: 20000 });

      let lastProductCount = 0;
      let sameCount = 0;
      const maxSameCount = 8;
      let iteration = 0;

      while (sameCount < maxSameCount) {
        iteration++;

        // Scroll the ci1XsL container
        await page.evaluate((selector) => {
          const container = document.querySelector(selector);
          if (container) {
            container.scrollBy(0, 800); // Scroll 800px down
          }
        }, scrollSelector);

        // Wait for lazy-loaded products to appear
        await sleep(2000);

        // Count loaded product cards
        const productCount = await page.evaluate(() => {
          return document.querySelectorAll("div[role='dialog'] div.SxLQB a").length;
        });

        console.log(`📜 Iteration ${iteration}: Products loaded = ${productCount}`);

        if (productCount === lastProductCount) {
          sameCount++;
        } else {
          sameCount = 0;
          lastProductCount = productCount;
        }
      }

      console.log(`✅ Finished scrolling - total products loaded: ${lastProductCount}`);
    } catch (e) {
      console.error("❌ Scrolling failed:", e.message);
      await page.screenshot({ path: 'debug_scroll_error.png', fullPage: true });
    }

    // Step 4 — Scrape products
    console.log("5️⃣ Scraping product details...");
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

        // Only include products whose name starts with "Chumbak" (case-insensitive)
        if (name && /^chumbak/i.test(name)) {
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

    console.log(`🔍 Scraped ${products.length} Chumbak products.`);

    // Step 5 — Save CSV
    if (products.length) {
      const header = ["name", "unit", "current_price", "original_price", "discount"];
      const csvData = [
        header.join(","),
        ...products.map((p) => header.map((h) => `"${(p[h] || "").replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      fs.writeFileSync("zepto_chumbak.csv", csvData);
      console.log("✅ Saved to zepto_chumbak.csv");
    } else {
      console.log("⚠️ No products found to save.");
    }

    // Step 6 — Write to Google Sheet
    if (products.length) {
      await writeToGoogleSheet(products);
    } else {
      console.log("⚠️ No products to write to Google Sheet.");
    }

  } catch (err) {
    console.error("❌ Scraper failed:", err.message);
    await page.screenshot({ path: 'debug_scraper_error.png', fullPage: true });
    console.log("📸 Debug screenshot saved as 'debug_scraper_error.png'");
  } finally {
    console.log("🛑 Closing browser");
    await browser.close();
  }
})();