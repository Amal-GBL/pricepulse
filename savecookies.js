const puppeteer = require("puppeteer");
const fs = require("fs");

async function saveCookies() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("https://blinkit.com/brand/Chumbak", { waitUntil: "networkidle2" });
  await page.waitForTimeout(10000); // Wait for manual interaction (e.g., CAPTCHA, login)
  const cookies = await page.cookies();
  fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
  console.log("Cookies saved to cookies.json");
  await browser.close();
}

saveCookies();