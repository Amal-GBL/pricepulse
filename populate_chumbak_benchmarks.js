// populate_benchmarks.js
const { google } = require('googleapis');

(async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: './credentials.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1HVALKEqNso9dXiy-qC4NyXhDFAgi66KDPuRepmEjVX0';

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

    // TRIGGER APPS SCRIPT
    const webhookUrl = 'https://script.google.com/macros/s/AKfycbw409S6cVgB3y9JscSA9mI6hlULRZcJWXQRQlCYA3VnCnV0PqGwlamBzw2OKu6mV9d6WQ/exec';
    console.log('Triggering price alert...');
    const res = await fetch(`${webhookUrl}?secret=mail123`, { method: 'POST' });
    const result = await res.json();
    console.log(result.success ? 'Email alert sent!' : 'Alert failed:', result.error);

    console.log('All done!');
})();