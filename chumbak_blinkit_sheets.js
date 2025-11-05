const puppeteer = require("puppeteer");
const fs = require("fs");
const { google } = require("googleapis");

// ---------------------------------------------------------------
//  Helpers (unchanged)
// ---------------------------------------------------------------
function cleanPrice(priceStr) {
  if (!priceStr || priceStr === "NA") return "NA";
  const price = priceStr.replace(/[^\d]/g, "");
  return price || "NA";
}

function calculateDiscount(currentPrice, originalPrice) {
  if (currentPrice === "NA" || originalPrice === "NA") return "NA";
  const current = parseFloat(currentPrice);
  const original = parseFloat(originalPrice);
  if (isNaN(current) || isNaN(original) || original === 0 || current >= original) return "NA";
  const discount = ((original - current) / original) * 100;
  return `${Math.round(discount)}%`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------
//  Google-Sheet writer (unchanged columns)
// ---------------------------------------------------------------
async function writeToGoogleSheet(data) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "./credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1HVALKEqNso9dXiy-qC4NyXhDFAgi66KDPuRepmEjVX0";
  const sheetName = "Blinkit";

  try {
    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });
    console.log("Cleared Blinkit tab.");

    // Header stays exactly the same
    const header = ["name", "unit", "current_price", "original_price", "discount"];
    const values = [
      header,
      ...Object.values(data).map(p => [
        p.name,
        p.sizes,
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
    console.log(`Wrote ${values.length - 1} products to Google Sheet.`);
  } catch (err) {
    console.error("Google Sheet error:", err.message);
    if (err.errors) console.error("Details:", err.errors);
  }
}

// ---------------------------------------------------------------
//  MAIN SCRAPER – BOTH COLLECTIONS
// ---------------------------------------------------------------
async function scrapeBlinkitChumbak(outputFile = "./blinkit_data.csv") {
  // ----- 1. URLs for the two collections -----
  const collections = [
    {
      name: "Chumbak",
      url:
        "https://blinkit.com/dc/?collection_filters=W3siYnJhbmRfaWQiOlsxNTE5M119XQ%3D%3D&collection_name=Chumbak&boost_collection_filters=%5B%7B%22filters%22%3A+%5B%7B%22type%22%3A+%22leaf_cat_id%22%2C+%22values%22%3A+%5B%228201%22%5D%7D%5D%7D%5D",
    },
    {
      name: "Teal by Chumbak",
      url:
        "https://blinkit.com/dc/?collection_filters=W3siYnJhbmRfaWQiOlsxNTE5Ml19XQ%3D%3D&collection_name=Teal+By+Chumbak&boost_collection_filters=%5B%7B%22filters%22%3A+%5B%7B%22type%22%3A+%22leaf_cat_id%22%2C+%22values%22%3A+%5B%22576%22%5D%7D%5D%7D%5D",
    },
  ];

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );

  // ----- 2. Re-usable helpers -----
  const setPincode = async () => {
    console.log("Setting pincode to 560012...");
    const pinSelectors = [
      "input[placeholder*='pincode']",
      "input[aria-label*='pincode']",
      "input[type='tel']",
      "input[type='text']",
    ];
    for (const sel of pinSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type("560012");
        await page.keyboard.press("Enter");
        await page.waitForNetworkIdle({ idleTime: 2000 }).catch(() => {});
        console.log("Pincode entered.");
        return true;
      }
    }
    console.warn("Pincode input not found – continuing without it.");
    return false;
  };

  const scrollToLoadAll = async () => {
    console.log("Scrolling to load all products...");
    let lastHeight = 0,
      stableCount = 0,
      attempt = 0,
      maxAttempts = 10;

    while (stableCount < 3 && attempt < maxAttempts) {
      const height = await page.evaluate(() => {
        const container =
          document.querySelector("#plpProductList") ||
          document.querySelector("#plpContainer");
        if (container) {
          container.scrollTo(0, container.scrollHeight);
          return container.scrollHeight;
        }
        return 0;
      });

      if (height === 0) {
        console.error("Product container not found.");
        break;
      }

      await sleep(4000);
      if (height === lastHeight) stableCount++;
      else stableCount = 0;
      lastHeight = height;
      attempt++;
      console.log(`Attempt ${attempt}/${maxAttempts}, height: ${height}, stable: ${stableCount}/3`);
    }
  };

  // ----- 3. Extract products (collection-aware ID) -----
  const extractProducts = async (collectionKey) => {
    const products = await page.$$("div[role='button'][id]");
    console.log(`Found ${products.length} product cards`);

    const collected = {};

    for (const product of products) {
      try {
        const rawId = (await page.evaluate(el => el.id, product)) || "NA";
        const productId = `${collectionKey}_${rawId}`; // unique key

        // ---- name ----
        const nameEl = await product.$(
          "div.tw-text-300.tw-font-semibold.tw-line-clamp-2[data-pf='reset']"
        );
        const name = nameEl
          ? await page.evaluate(el => el.innerText.trim(), nameEl)
          : "NA";
        if (name === "NA") continue;

        // ---- prices ----
        let curPrice = "NA",
          origPrice = "NA";
        const priceContainer = await product.$(
          "div.tw-flex.tw-items-center.tw-justify-between"
        );
        if (priceContainer) {
          const curEl = await priceContainer.$("div.tw-text-200.tw-font-semibold");
          const origEl = await priceContainer.$(
            "div.tw-text-200.tw-font-regular.tw-line-through"
          );
          curPrice = curEl
            ? cleanPrice(await page.evaluate(el => el.innerText.trim(), curEl))
            : "NA";
          origPrice = origEl
            ? cleanPrice(await page.evaluate(el => el.innerText.trim(), origEl))
            : curPrice;
        }

        const discount = calculateDiscount(curPrice, origPrice);

        // ---- size / unit ----
        let sizes = "NA";
        const sizeEl = await product.$("tw-text-200 tw-font-medium tw-line-clamp-1");
        if (sizeEl) {
          const txt = await page.evaluate(el => el.innerText.trim(), sizeEl);
          if (/size|age|pair/i.test(txt)) sizes = txt;
        }

        // ---- stock ----
        let stockStatus = "In Stock";
        const outEl = await product.$("div.tw-absolute.tw-bottom-1\\/2");
        if (outEl) {
          const txt = await page.evaluate(el => el.innerText.trim(), outEl);
          if (/out of stock/i.test(txt)) stockStatus = "Out of Stock";
        }

        collected[productId] = {
          name,
          current_price: curPrice,
          original_price: origPrice,
          discount,
          sizes,
          stock: stockStatus,
        };
      } catch (e) {
        console.log(`Error on product in ${collectionKey}: ${e.message}`);
      }
    }
    return collected;
  };

  // ----- 4. Run for every collection -----
  const allCollected = {};

  try {
    // Home → pincode (once)
    console.log("Opening homepage...");
    await page.goto("https://blinkit.com/", {
      waitUntil: "networkidle2",
      timeout: 120000,
    });
    await setPincode();
    await sleep(3000);

    for (const col of collections) {
      const key = col.name.toLowerCase().replace(/\s+/g, "_"); // e.g. "teal_by_chumbak"
      console.log(`\n=== Scraping ${col.name} ===`);
      await page.goto(col.url, { waitUntil: "networkidle2", timeout: 120000 });
      await sleep(5000);
      await scrollToLoadAll();

      const data = await extractProducts(key);
      console.log(`Collected ${Object.keys(data).length} items from ${col.name}`);

      Object.assign(allCollected, data);
    }

    // ----- 5. Write CSV (same columns) -----
    const header = [
      "name",
      "unit",
      "current_price",
      "original_price",
      "discount",
    ];
    const csvRows = [header.join(",")];
    Object.values(allCollected).forEach(p => {
      csvRows.push(
        header
          .map(h => `"${(p[h] ?? "").toString().replace(/"/g, '""')}"`)
          .join(",")
      );
    });
    fs.writeFileSync(outputFile, csvRows.join("\n"), "utf-8");
    console.log(`\nSaved ${Object.keys(allCollected).length} products → ${outputFile}`);

    // ----- 6. Write Google Sheet (same layout) -----
    await writeToGoogleSheet(allCollected);
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await browser.close();
  }
}

// -----------------------------------------------------------------
scrapeBlinkitChumbak();