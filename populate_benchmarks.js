// populate_benchmarks.js
const { google } = require('googleapis');
const fetch = require('node-fetch'); // npm install node-fetch@2

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzOro7020xo1KRZRsY3WvaefMmVEWjOWRrfui8OmCgbV4ZiSOpS0trQD8en5uqCe8nH8Q/exec'; // ← YOUR WEB APP URL
const SECRET = 'mail123';

(async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: './credentials.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '17CaPQYQIpC5wG16lYWHRbCy04eRzYCjfK0a-wBM2z2c';

    const tabs = [
        { name: 'Blinkit', sheet: 'Blinkit' },
        { name: 'Instamart', sheet: 'Instamart' },
        { name: 'Zepto', sheet: 'Zepto' }
    ];

    // Load existing Benchmarks
    console.log('Loading existing Benchmarks...');
    const existingResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Benchmarks!A:Z',
    });
    const existingValues = existingResponse.data.values || [];
    const existingHeader = existingValues[0] || ['Name', 'Blinkit', 'Instamart', 'Zepto'];
    const existingData = existingValues.slice(1);

    const existingMap = {};
    existingData.forEach(row => {
        const product = row[0];
        if (product) existingMap[product] = row;
    });

    // Fetch product names
    const platformProducts = {};
    for (const tab of tabs) {
        console.log(`Scanning ${tab.name}...`);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${tab.sheet}!A2:A`,
        });
        platformProducts[tab.name] = (response.data.values || [])
            .map(row => row[0])
            .filter(name => name);
        console.log(`${tab.name}: ${platformProducts[tab.name].length} products`);
    }

    // Build new Benchmarks
    const allProducts = new Set();
    Object.values(platformProducts).forEach(products => {
        products.forEach(name => allProducts.add(name));
    });

    const values = [existingHeader];
    allProducts.forEach(productName => {
        const existingRow = existingMap[productName];
        const row = existingRow ? [...existingRow] : [productName, '', '', ''];
        while (row.length < existingHeader.length) row.push('');
        values.push(row);
    });

    // Update Benchmarks
    console.log('Updating Benchmarks...');
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Benchmarks!A:Z' });
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Benchmarks!A1',
        valueInputOption: 'RAW',
        resource: { values },
    });
    console.log(`Benchmarks refreshed: ${allProducts.size} products`);

    // === RELIABLE ALERT TRIGGER ===
    console.log('Triggering price alert...');
    const payload = { secret: SECRET };

    const triggerAlert = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
            try {
                const res = await fetch(WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    timeout: 30000
                });

                const result = await res.json();
                if (result.success) {
                    console.log('EMAIL ALERT SENT!');
                    return;
                } else {
                    console.warn(`Attempt ${i + 1} failed:`, result.error);
                }
            } catch (err) {
                console.warn(`Attempt ${i + 1} network error:`, err.message);
            }
            if (i < retries - 1) await new Promise(r => setTimeout(r, 2000));
        }
        console.error('ALL ALERT ATTEMPTS FAILED');
    };

    await triggerAlert();

    console.log('All done!');
})();