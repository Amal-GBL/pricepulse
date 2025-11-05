export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { csv } = req.body;
    const response = await fetch('https://script.google.com/macros/s/AKfycbxHAB-9i64fPWs6ZM5C059YdJinDRpTUn0GOJ0xkBrEEAHjapLV_Wo_PGJSsrd4PkUe-w/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv })
    });
    
    const result = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}