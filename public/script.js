document.addEventListener('DOMContentLoaded', () => {
    feather.replace();
    const tablesDiv = document.getElementById('tables');
    const filterSelect = document.getElementById('filterSelect');

    async function renderTables(filter = 'all') {
        try {
            const response = await fetch('/api/products');
            if (!response.ok) throw new Error('Failed to fetch data');
            const products = await response.json();

            const platforms = ['Blinkit', 'Instamart', 'Zepto'];
            tablesDiv.innerHTML = '';

            platforms.forEach(platform => {
                const platformProducts = products.filter(p => p.platform === platform && (filter === 'all' || p.price_status === filter));
                if (platformProducts.length === 0) return;

                const table = `
                    <div class="bg-white rounded-xl shadow-md p-6 mb-8">
                        <h3 class="text-lg font-semibold mb-4">${platform}</h3>
                        <div class="overflow-x-auto">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit/Sizes</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Price</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Benchmark Price</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    </tr>
                                </thead>
                                <tbody class="bg-white divide-y divide-gray-200">
                                    ${platformProducts.map(p => `
                                        <tr>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${p.name}</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${p.unit}</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm text-${p.price_status === 'below' ? 'green' : p.price_status === 'above' ? 'red' : 'blue'}-500 font-bold">${p.current_price !== 'NA' ? '₹' + p.current_price : 'NA'}</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${p.benchmark_price !== 'NA' ? '₹' + p.benchmark_price : 'NA'}</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-sm text-${p.price_status === 'below' ? 'green' : p.price_status === 'above' ? 'red' : 'blue'}-500 font-bold">${p.price_status.toUpperCase()}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
                tablesDiv.innerHTML += table;
            });
        } catch (err) {
            tablesDiv.innerHTML = '<p class="text-red-500">Error loading data: ' + err.message + '</p>';
            console.error(err);
        }
    }

    renderTables();
    filterSelect.addEventListener('change', () => renderTables(filterSelect.value));
});