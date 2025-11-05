const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

exports.saveBenchmarks = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  
  try {
    const { csv } = req.body;
    const sheet = admin
      .spreadsheet('17CaPQYQIpC5wG16lYWHRbCy04eRzYCjfK0a-wBM2z2c')
      .sheet('benchmarks');
    
    await sheet.clear();
    const rows = csv.split('\n').map(row => row.split(','));
    await sheet.setHeaderRow(rows[0]);
    if (rows.length > 1) {
      await sheet.addRows(rows.slice(1));
    }
    
    res.json({ status: 'success' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});