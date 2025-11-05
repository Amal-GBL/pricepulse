const puppeteer = require("puppeteer");
const fs = require("fs");
const { google } = require("googleapis");

// -------------------------------------------------
// Helper: clean price string → keep only digits
// -------------------------------------------------
function cleanPrice(priceStr) {
  if (!priceStr || priceStr === "NA") return "NA";
  const price = priceStr.replace(/[^\d]/g, "");
  return price || "NA";
}

// -------------------------------------------------
// Helper: calculate discount from two prices
// -------------------------------------------------
function calculateDiscount(cur, orig) {
  const curNum = parseFloat(cur);
  const origNum = parseFloat(orig);
  if (isNaN(curNum) || isNaN(origNum) || origNum === 0) return "0% OFF";
  if (curNum === origNum) return "0% OFF";

  const percent = ((origNum - curNum) / origNum) * 100;
  return `${percent.toFixed(0)}% OFF`;
}

// -------------------------------------------------
// Sleep helper
// -------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------------
// Write to Google Sheet
// -------------------------------------------------
async function writeToGoogleSheet(data) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "./credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "17CaPQYQIpC5wG16lYWHRbCy04eRzYCjfK0a-wBM2z2c";
  const sheetName = "Blinkit";

  try {
    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });
    console.log("Cleared Blinkit tab.");

    // Header + rows (discount is now calculated)
    const header = ["name", "unit", "current_price", "original_price", "discount"];
    const values = [
      header,
      ...Object.values(data).map(p => [
        p.name,
        p.sizes,
        p.current_price,
        p.original_price,
        p.discount,               // <-- calculated, never "NA" from scraper
      ]),
    ];

    // Write data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      resource: { values },
    });
    console.log(`Wrote ${values.length - 1} products to Google Sheet.`);
  } catch (err) {
    console.error("Google Sheet error:", err.message);
    if (err.errors) console.error("Details:", err.errors);
  }
}

// -------------------------------------------------
// MAIN SCRAPER
// -------------------------------------------------
async function scrapeBlinkitPepe(outputFile = "./blinkit_data.csv") {
  const url =
    "https://blinkit.com/dc/?collection_filters=W3siYnJhbmRfaWQiOlsxNjIyOF19XQ%3D%3D&collection_name=Pepe+Jeans+Innerfashion";

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );

  try {
    console.log("Opening homepage...");
    await page.goto("https://blinkit.com/", { waitUntil: "networkidle2", timeout: 120000 });

    // ---------- Set pincode ----------
    console.log("Setting pincode to 560012...");
    const pinSelectors = [
      "input[placeholder*='pincode']",
      "input[aria-label*='pincode']",
      "input[type='tel']",
      "input[type='text']",
    ];
    let pinSet = false;
    for (const sel of pinSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type("560012");
        await page.keyboard.press("Enter");
        await page.waitForNetworkIdle({ idleTime: 2000 }).catch(() => console.log("Network idle timeout, proceeding..."));
        console.log("Pincode entered.");
        pinSet = true;
        break;
      }
    }
    if (!pinSet) console.warn("Pincode input not found. Data may be incomplete.");

    // ---------- Navigate to collection ----------
    console.log(`Opening URL: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(5000);

    // ---------- Scroll to load all products ----------
    console.log("Scrolling to load products...");
    let lastHeight = 0;
    let stableCount = 0;
    const maxScrollAttempts = 15;
    let attempt = 0;

    while (stableCount < 3 && attempt < maxScrollAttempts) {
      const currentHeight = await page.evaluate(() => {
        const container = document.querySelector("#plpProductList") || document.querySelector("#plpContainer");
        if (container) {
          container.scrollTo(0, container.scrollHeight);
          return container.scrollHeight;
        }
        return 0;
      });

      if (currentHeight === 0) {
        console.error("Product container not found. Check selector.");
        break;
      }

      await sleep(4000);

      if (currentHeight === lastHeight) stableCount++;
      else stableCount = 0;

      lastHeight = currentHeight;
      attempt++;
      console.log(`Attempt ${attempt}/${maxScrollAttempts}, height: ${currentHeight}, stable: ${stableCount}/3`);
    }

    // ---------- Collect products ----------
    console.log("Collecting products...");
    const products = await page.$$("div[role='button'][id]");
    console.log(`Found ${products.length} product elements`);

    const collected = {};

    for (const product of products) {
      try {
        const productId = (await page.evaluate(el => el.id, product)) || "NA";

        // ---- Name ----
        const nameEl = await product.$("div.tw-text-300.tw-font-semibold.tw-line-clamp-2[data-pf='reset']");
        const name = nameEl ? await page.evaluate(el => el.innerText.trim(), nameEl) : "NA";
        if (name === "NA") {
          console.log(`Skipping ${productId}: no name`);
          continue;
        }

        // ---- Prices ----
        let curPrice = "NA";
        let origPrice = "NA";
        const priceContainer = await product.$("div.tw-flex.tw-items-center.tw-justify-between");
        if (priceContainer) {
          const curEl = await priceContainer.$("div.tw-text-200.tw-font-semibold");
          const origEl = await priceContainer.$("div.tw-text-200.tw-font-regular.tw-line-through");
          curPrice = curEl ? cleanPrice(await page.evaluate(el => el.innerText.trim(), curEl)) : "NA";
          origPrice = origEl ? cleanPrice(await page.evaluate(el => el.innerText.trim(), origEl)) : curPrice;
        }

        // ---- Discount (calculated) ----
        const discount = calculateDiscount(curPrice, origPrice);

        // ---- Sizes ----
        let sizes = "NA";
        const sizeEl = await product.$("div.tw-text-050.tw-font-050");
        if (sizeEl) {
          const sizeText = await page.evaluate(el => el.innerText.trim(), sizeEl);
          if (sizeText.toLowerCase().includes("size") ||
              sizeText.toLowerCase().includes("age") ||
              sizeText.toLowerCase().includes("pair")) {
            sizes = sizeText;
          }
        }

        // ---- Stock ----
        let stockStatus = "In Stock";
        const outOfStockEl = await product.$("div.tw-absolute.tw-bottom-1\\/2");
        if (outOfStockEl) {
          const stockText = await page.evaluate(el => el.innerText.trim(), outOfStockEl);
          if (stockText.toLowerCase().includes("out of stock")) {
            stockStatus = "Out of Stock";
          }
        }

        collected[productId] = {
          name,
          current_price: curPrice,
          original_price: origPrice,
          discount,          // <-- calculated
          sizes,
          stock: stockStatus,
        };
      } catch (err) {
        console.log(`Error processing product ${productId}: ${err.message}`);
        continue;
      }
    }

    console.log(`Processed ${products.length} elements, collected ${Object.keys(collected).length} unique products`);

    // ---------- CSV ----------
    const header = ["name", "current_price", "original_price", "discount", "sizes", "stock"];
    const csvRows = [header.join(",")];
    Object.values(collected).forEach(p => {
      csvRows.push(header.map(h => `"${p[h]}"`).join(","));
    });
    fs.writeFileSync(outputFile, csvRows.join("\n"), "utf-8");
    console.log(`Saved ${Object.keys(collected).length} products to ${outputFile}`);

    // ---------- Google Sheet ----------
    await writeToGoogleSheet(collected);

  } catch (err) {
    console.error("Scraping error:", err.message);
  } finally {
    await browser.close();
  }
}

// -------------------------------------------------
// Run
// -------------------------------------------------
scrapeBlinkitPepe();