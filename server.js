const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Load credentials
let credentials;
if (process.env.GOOGLE_CREDENTIALS) {
  credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString());
} else {
  credentials = require('./credentials.json');
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '17CaPQYQIpC5wG16lYWHRbCy04eRzYCjfK0a-wBM2z2c';
const password = process.env.BENCHMARK_PASSWORD || 'brandhead123'; // Set via Vercel env variable

// Middleware for basic password protection
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader === `Bearer ${password}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// API to fetch products and benchmarks
app.get('/api/products', async (req, res) => {
  try {
    const tabs = ['Blinkit', 'Instamart', 'Zepto'];
    const productsByPlatform = {};

    // Fetch current prices
    for (const tab of tabs) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!A2:E`,
      });
      const rows = response.data.values || [];
      productsByPlatform[tab] = rows.map(row => ({
        name: row[0] || 'NA',
        unit: row[1] || 'NA',
        current_price: row[2] && row[2] !== 'NA' ? parseFloat(row[2]) : 'NA',
        original_price: row[3] && row[3] !== 'NA' ? parseFloat(row[3]) : 'NA',
        discount: row[4] || 'NA',
        platform: tab
      }));
    }

    // Fetch benchmarks
    const benchmarkResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Benchmarks!A2:C',
    });
    const benchmarks = (benchmarkResponse.data.values || []).reduce((acc, row) => {
      const key = `${row[0]}_${row[1]}`; // name_platform
      acc[key] = parseFloat(row[2]) || 'NA';
      return acc;
    }, {});

    // Combine products with benchmarks
    const allProducts = [];
    for (const platform of Object.keys(productsByPlatform)) {
      productsByPlatform[platform].forEach(product => {
        const benchmark = benchmarks[`${product.name}_${platform}`] || 'NA';
        allProducts.push({
          ...product,
          benchmark_price: benchmark,
          price_status: product.current_price !== 'NA' && benchmark !== 'NA'
            ? product.current_price < benchmark ? 'below'
            : product.current_price > benchmark ? 'above' : 'equal'
            : 'NA'
        });
      });
    }

    res.json(allProducts);
  } catch (err) {
    console.error('Error fetching data:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// API to fetch and update benchmarks
app.get('/api/benchmarks', authenticate, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Benchmarks!A2:C',
    });
    const benchmarks = (response.data.values || []).map(row => ({
      name: row[0] || 'NA',
      platform: row[1] || 'NA',
      benchmark_price: row[2] && row[2] !== 'NA' ? parseFloat(row[2]) : 'NA'
    }));
    res.json(benchmarks);
  } catch (err) {
    console.error('Error fetching benchmarks:', err.message);
    res.status(500).json({ error: 'Failed to fetch benchmarks' });
  }
});

app.post('/api/benchmarks', authenticate, async (req, res) => {
  try {
    const { name, platform, benchmark_price } = req.body;
    if (!name || !platform || !benchmark_price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Fetch existing benchmarks
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Benchmarks!A2:C',
    });
    const rows = response.data.values || [];
    const key = `${name}_${platform}`;
    const existingIndex = rows.findIndex(row => `${row[0]}_${row[1]}` === key);

    // Update or append
    if (existingIndex >= 0) {
      rows[existingIndex][2] = benchmark_price;
    } else {
      rows.push([name, platform, benchmark_price]);
    }

    // Write back to sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Benchmarks!A2:C',
      valueInputOption: 'RAW',
      resource: { values: rows },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating benchmarks:', err.message);
    res.status(500).json({ error: 'Failed to update benchmarks' });
  }
});

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/benchmarks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'benchmarks.html'));
});

module.exports = app;