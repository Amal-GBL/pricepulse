document.addEventListener('DOMContentLoaded', () => {
    feather.replace();

    const passwordPrompt = document.getElementById('passwordPrompt');
    const benchmarkForm = document.getElementById('benchmarkForm');
    const benchmarksTableContainer = document.getElementById('benchmarksTableContainer');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');
    const productSelect = document.getElementById('productSelect');
    const blinkitBenchmark = document.getElementById('blinkitBenchmark');
    const swiggyBenchmark = document.getElementById('swiggyBenchmark');
    const zeptoBenchmark = document.getElementById('zeptoBenchmark');
    const saveBenchmarks = document.getElementById('saveBenchmarks');
    const benchmarksTable = document.getElementById('benchmarksTable');

    const password = 'brandhead123'; // Must match BENCHMARK_PASSWORD in server.js

    // Check authentication
    loginBtn.addEventListener('click', async () => {
        if (passwordInput.value === password) {
            passwordPrompt.classList.add('hidden');
            benchmarkForm.classList.remove('hidden');
            benchmarksTableContainer.classList.remove('hidden');
            await fetchData();
        } else {
            alert('Incorrect password');
        }
    });

    async function fetchData() {
        try {
            // Fetch products for dropdown
            const productsResponse = await fetch('/api/products', { headers: { 'Authorization': `Bearer ${password}` } });
            if (!productsResponse.ok) throw new Error('Failed to fetch products');
            const products = await productsResponse.json();
            const uniqueProducts = [...new Set(products.map(p => p.name))].sort();
            productSelect.innerHTML = '<option value="">-- Select Product --</option>' + 
                uniqueProducts.map(name => `<option value="${name}">${name}</option>`).join('');

            // Fetch benchmarks
            const benchmarksResponse = await fetch('/api/benchmarks', { headers: { 'Authorization': `Bearer ${password}` } });
            if (!benchmarksResponse.ok) throw new Error('Failed to fetch benchmarks');
            const benchmarks = await benchmarksResponse.json();
            renderBenchmarksTable(benchmarks);

            // Update form when product is selected
            productSelect.addEventListener('change', () => {
                const selectedProduct = productSelect.value;
                const productBenchmarks = benchmarks.filter(b => b.name === selectedProduct);
                blinkitBenchmark.value = productBenchmarks.find(b => b.platform === 'Blinkit')?.benchmark_price || '';
                swiggyBenchmark.value = productBenchmarks.find(b => b.platform === 'Instamart')?.benchmark_price || '';
                zeptoBenchmark.value = productBenchmarks.find(b => b.platform === 'Zepto')?.benchmark_price || '';
            });
        } catch (err) {
            benchmarksTable.innerHTML = '<tr><td colspan="4" class="text-red-500">Error loading data: ' + err.message + '</td></tr>';
            console.error(err);
        }
    }

    function renderBenchmarksTable(benchmarks) {
        const products = [...new Set(benchmarks.map(b => b.name))].sort();
        benchmarksTable.innerHTML = products.map(name => {
            const blinkit = benchmarks.find(b => b.name === name && b.platform === 'Blinkit')?.benchmark_price || 'NA';
            const instamart = benchmarks.find(b => b.name === name && b.platform === 'Instamart')?.benchmark_price || 'NA';
            const zepto = benchmarks.find(b => b.name === name && b.platform === 'Zepto')?.benchmark_price || 'NA';
            return `
                <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${blinkit !== 'NA' ? '₹' + parseFloat(blinkit).toFixed(2) : 'NA'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${instamart !== 'NA' ? '₹' + parseFloat(instamart).toFixed(2) : 'NA'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${zepto !== 'NA' ? '₹' + parseFloat(zepto).toFixed(2) : 'NA'}</td>
                </tr>
            `;
        }).join('');
    }

    saveBenchmarks.addEventListener('click', async () => {
        const name = productSelect.value;
        if (!name) {
            alert('Please select a product');
            return;
        }

        const updates = [
            { platform: 'Blinkit', benchmark_price: blinkitBenchmark.value },
            { platform: 'Instamart', benchmark_price: swiggyBenchmark.value },
            { platform: 'Zepto', benchmark_price: zeptoBenchmark.value }
        ].filter(u => u.benchmark_price); // Only include non-empty values

        try {
            for (const update of updates) {
                const response = await fetch('/api/benchmarks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${password}`
                    },
                    body: JSON.stringify({ name, platform: update.platform, benchmark_price: update.benchmark_price })
                });
                if (!response.ok) throw new Error('Failed to save benchmark for ' + update.platform);
            }
            alert('Benchmarks saved successfully!');
            await fetchData(); // Refresh table
        } catch (err) {
            alert('Error saving benchmarks: ' + err.message);
        }
    });
});