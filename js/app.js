// Global variables
let db = null;
let stockData = [];
let portfolioData = [];
let allStocks = [];          // [{symbol, name, sector, region}] for all tracked stocks
const stockInfoMap = {};     // symbol -> {name, sector, region}

// Initialize sql.js
// Using the newer sql-wasm.js which exposes initSqlJs as a global
async function initSqlJsLib() {
    try {
        // Check if initSqlJs is available as a global
        if (typeof initSqlJs === 'function') {
            const SQL = await initSqlJs({
                locateFile: file => `https://sql.js.org/dist/${file}`
            });
            return SQL;
        } else {
            throw new Error('initSqlJs is not defined. Check sql.js CDN URL.');
        }
    } catch (err) {
        console.error("Failed to load sql.js:", err);
        throw err;
    }
}

// Load database
async function loadDatabase() {
    showLoading();
    
    try {
        const response = await fetch('data/processed/finance_data.sqlite');
        if (!response.ok) {
            throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
        }
        
        const dbArrayBuffer = await response.arrayBuffer();
        
        const SQL = await initSqlJsLib();
        db = new SQL.Database(new Uint8Array(dbArrayBuffer));
        
        console.log("Database loaded successfully");
        
        // Now load data using the database
        await Promise.all([
            loadStockList(),
            loadPortfolioSummary(),
            loadAllStockMetrics()
        ]);
        
    } catch (err) {
        console.error("Failed to load database:", err);
        console.error("Stack:", err.stack);
        document.getElementById('portfolio-summary').innerHTML = `
            <div class="error">
                <strong>Error loading database:</strong><br>
                ${err.message}<br><br>
                <small>Stack: ${err.stack}</small><br>
                <small>SQL object exists: ${typeof SQL !== 'undefined'}</small><br>
                <small>initSqlJs exists: ${typeof initSqlJs !== 'undefined'}</small>
            </div>
        `;
    } finally {
        hideLoading();
    }
}

// Show loading indicator
function showLoading() {
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        if (tab.style.display !== 'none') {
            tab.insertAdjacentHTML('afterbegin', '<div class="loading-indicator" style="text-align: center; padding: 50px;"><h3>Loading data <span class="loading"></span></h3></div>');
        }
    });
}

// Hide loading indicator (remove the whole block, not just the spinner)
function hideLoading() {
    document.querySelectorAll('.loading-indicator').forEach(el => el.remove());
}

// Load stock list for dropdown
function loadStockList() {
    try {
        if (!db) {
            console.error("Database not initialized");
            return;
        }
        
        const stmt = db.prepare(
            "SELECT symbol, name, sector, region FROM stocks ORDER BY sector, symbol");
        allStocks = [];
        while (stmt.step()) {
            // getAsObject() returns a {column: value} object; get() returns a
            // positional array, which is why named access used to be undefined.
            const row = stmt.getAsObject();
            allStocks.push(row);
            stockInfoMap[row.symbol] = row;
        }
        stmt.free();

        // Populate the Stock Analysis picker and the Build Portfolio picker,
        // both grouped into <optgroup>s by sector.
        populateStockSelect('stock-select', '-- Select a stock --');
        populateStockSelect('builder-stock', '-- Select a stock --');
        renderHoldings();  // show the builder's empty state

        console.log(`Loaded ${allStocks.length} stocks`);
    } catch (err) {
        console.error("Error loading stock list:", err);
    }
}

// Fill a <select> with all stocks, grouped into <optgroup>s by sector.
function populateStockSelect(selectId, placeholder) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = `<option value="">${placeholder}</option>`;

    const bySector = {};
    allStocks.forEach(stock => {
        const sector = stock.sector || 'Other';
        (bySector[sector] = bySector[sector] || []).push(stock);
    });
    Object.keys(bySector).sort().forEach(sector => {
        const group = document.createElement('optgroup');
        group.label = sector;
        bySector[sector].forEach(stock => {
            const option = document.createElement('option');
            const region = stock.region ? ` · ${stock.region}` : '';
            option.value = stock.symbol;
            option.textContent = `${stock.symbol} — ${stock.name || ''}${region}`;
            group.appendChild(option);
        });
        select.appendChild(group);
    });
}

// Load all stock metrics for portfolio tab
function loadAllStockMetrics() {
    try {
        if (!db) {
            console.error("Database not initialized");
            return;
        }
        
        // Join in sector/region so the comparison charts can group by sector.
        const stmt = db.prepare(`
            SELECT m.*, s.sector, s.region
            FROM stock_risk_metrics m
            JOIN stocks s ON s.symbol = m.symbol
            ORDER BY s.sector, m.symbol
        `);
        stockData = [];
        while (stmt.step()) {
            stockData.push(stmt.getAsObject());
        }
        stmt.free();
        
        console.log(`Loaded metrics for ${stockData.length} stocks`);
        createPortfolioCharts();
    } catch (err) {
        console.error("Error loading stock metrics:", err);
    }
}

// Load portfolio summary
function loadPortfolioSummary() {
    try {
        if (!db) {
            console.error("Database not initialized");
            return;
        }
        
        const stmt = db.prepare(`
            SELECT * FROM portfolio_risk_metrics 
            WHERE portfolio_id = 1
            ORDER BY calculated_at DESC LIMIT 1
        `);
        
        const summaryDiv = document.getElementById('portfolio-summary');
        
        if (stmt.step()) {
            const metrics = stmt.getAsObject();

            const annualizedReturn = (metrics.mean_return * 252 * 100).toFixed(2);
            const volatility = (metrics.volatility * 100).toFixed(2);
            const sharpeRatio = metrics.sharpe_ratio ? metrics.sharpe_ratio.toFixed(2) : 'N/A';
            const maxDrawdown = (metrics.max_drawdown * 100).toFixed(2);
            const calculatedAt = metrics.calculated_at ? new Date(metrics.calculated_at).toLocaleDateString() : 'N/A';
            
            summaryDiv.innerHTML = `
                <div class="metrics-grid">
                    <div class="metric-card">
                        <h3>Annualized Return</h3>
                        <p>${annualizedReturn}%</p>
                        <span class="label">Portfolio Performance</span>
                    </div>
                    <div class="metric-card">
                        <h3>Annualized Volatility</h3>
                        <p>${volatility}%</p>
                        <span class="label">Risk Measure</span>
                    </div>
                    <div class="metric-card">
                        <h3>Sharpe Ratio</h3>
                        <p>${sharpeRatio}</p>
                        <span class="label">Risk-Adjusted Return</span>
                    </div>
                    <div class="metric-card">
                        <h3>Max Drawdown</h3>
                        <p>${maxDrawdown}%</p>
                        <span class="label">Worst Loss</span>
                    </div>
                </div>
                <div class="info">
                    <strong>Last Updated:</strong> ${calculatedAt}
                </div>
            `;
        } else {
            summaryDiv.innerHTML = `
                <div class="error">
                    <strong>No portfolio metrics found.</strong><br>
                    Run R scripts to calculate metrics first.
                </div>
            `;
        }
        stmt.free();
        
        // Load R-generated visualizations
        loadVisualizations();
        
    } catch (err) {
        console.error("Error loading portfolio summary:", err);
        document.getElementById('portfolio-summary').innerHTML = `
            <div class="error">
                <strong>Error loading portfolio summary:</strong> ${err.message}
            </div>
        `;
    }
}

// Load R-generated visualizations (optional - only embedded if the files exist)
async function loadVisualizations() {
    const vizContainer = document.getElementById('portfolio-visualizations');
    if (!vizContainer) return;

    const visualizations = [
        { name: 'Portfolio Summary', file: 'r/output/portfolio_summary.html' },
        { name: 'Combined Dashboard', file: 'r/output/dashboard_combined.html' }
    ];

    for (const viz of visualizations) {
        try {
            // Only embed the iframe if the file is actually present, otherwise
            // we'd render a broken 404 frame. These are generated by the R
            // scripts and are absent in the default sample build.
            const head = await fetch(viz.file, { method: 'HEAD' });
            if (!head.ok) continue;

            const frame = document.createElement('iframe');
            frame.src = viz.file;
            frame.title = viz.name;
            frame.style = 'width: 100%; height: 500px; border: none; border-radius: 0; margin-bottom: 20px;';
            vizContainer.appendChild(frame);
        } catch (err) {
            console.log(`Could not load ${viz.file}:`, err);
        }
    }
}

// Distinct colour per sector, so the same sector reads consistently across
// every chart. Falls back to a neutral grey for any unmapped sector.
const SECTOR_COLORS = {
    'Technology': '#3E7C8C',
    'Communication Services': '#8E6E95',
    'Consumer Discretionary': '#C0432B',
    'Consumer Staples': '#D98E32',
    'Financial Services': '#4A7C59',
    'Health Care': '#C75D6F',
    'Energy': '#6B4226',
    'Industrials': '#7A8B99',
    'Materials': '#9C7A3C',
    'Utilities': '#5B8A72',
    'Real Estate': '#A6583C'
};
const sectorColor = sector => SECTOR_COLORS[sector] || '#999999';

// Common Plotly layout bits (Tunnel palette).
const BASE_LAYOUT = {
    showlegend: true,
    legend: { orientation: 'h', y: -0.25, font: { size: 11 } },
    plot_bgcolor: '#EDE7D3',
    paper_bgcolor: '#EDE7D3',
    font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
};

// Group stockData by sector, preserving the sector-sorted order.
function groupBySector() {
    const groups = {};
    stockData.forEach(s => {
        const sector = s.sector || 'Other';
        (groups[sector] = groups[sector] || []).push(s);
    });
    return groups;
}

// Build one bar trace per sector so the chart is coloured and legended by
// sector. valueFn maps a stock row to its bar height.
function sectorBarTraces(valueFn, fmt) {
    const groups = groupBySector();
    return Object.keys(groups).sort().map(sector => ({
        name: sector,
        type: 'bar',
        x: groups[sector].map(s => s.symbol),
        y: groups[sector].map(valueFn),
        marker: { color: sectorColor(sector), line: { color: '#4A3823', width: 1 } },
        text: groups[sector].map(s => `${s.symbol} (${sector})<br>${fmt(s)}`),
        hoverinfo: 'text'
    }));
}

// Create portfolio charts using Plotly.js, grouped by sector.
function createPortfolioCharts() {
    if (stockData.length === 0) return;

    // Keep bars in sector-clustered order on a shared x-axis.
    const categoryOrder = stockData.map(s => s.symbol);
    const barXAxis = { title: 'Stock', categoryorder: 'array', categoryarray: categoryOrder };

    // Volatility chart
    Plotly.newPlot('volatility-chart',
        sectorBarTraces(s => s.volatility * 100,
            s => `Volatility: ${(s.volatility * 100).toFixed(2)}%`),
        Object.assign({}, BASE_LAYOUT, {
            title: 'Annualized Volatility by Stock (grouped by sector)',
            xaxis: barXAxis, yaxis: { title: 'Volatility (%)' }
        }), { responsive: true });

    // Sharpe ratio chart
    Plotly.newPlot('sharpe-chart',
        sectorBarTraces(s => s.sharpe_ratio || 0,
            s => `Sharpe: ${(s.sharpe_ratio || 0).toFixed(2)}`),
        Object.assign({}, BASE_LAYOUT, {
            title: 'Sharpe Ratio by Stock (grouped by sector)',
            xaxis: barXAxis, yaxis: { title: 'Sharpe Ratio' }
        }), { responsive: true });

    // Max drawdown chart
    Plotly.newPlot('drawdown-chart',
        sectorBarTraces(s => s.max_drawdown * 100,
            s => `Max Drawdown: ${(s.max_drawdown * 100).toFixed(2)}%`),
        Object.assign({}, BASE_LAYOUT, {
            title: 'Maximum Drawdown by Stock (grouped by sector)',
            xaxis: barXAxis, yaxis: { title: 'Max Drawdown (%)' }
        }), { responsive: true });

    // Risk-return scatter plot, one trace per sector.
    const groups = groupBySector();
    const scatterData = Object.keys(groups).sort().map(sector => ({
        name: sector,
        mode: 'markers+text',
        type: 'scatter',
        x: groups[sector].map(s => s.mean_return * 252 * 100),
        y: groups[sector].map(s => s.volatility * 100),
        text: groups[sector].map(s => s.symbol),
        textposition: 'top center',
        textfont: { size: 10, family: 'IBM Plex Mono, monospace' },
        marker: { size: 11, color: sectorColor(sector), line: { color: '#4A3823', width: 1 } },
        hovertemplate: '%{text}<br>Return: %{x:.1f}%<br>Volatility: %{y:.1f}%' +
                       `<extra>${sector}</extra>`
    }));

    Plotly.newPlot('risk-return-scatter', scatterData,
        Object.assign({}, BASE_LAYOUT, {
            title: 'Risk-Return Profile (grouped by sector)',
            xaxis: { title: 'Annualized Return (%)' },
            yaxis: { title: 'Annualized Volatility (%)' }
        }), { responsive: true });
}

// Load stock metrics
function loadStockMetrics() {
    const symbol = document.getElementById('stock-select').value;
    if (!symbol) {
        document.getElementById('stock-metrics').innerHTML = '';
        document.getElementById('stock-price-chart').innerHTML = '';
        document.getElementById('stock-returns-chart').innerHTML = '';
        return;
    }
    
    showLoading();
    
    try {
        // Get stock metrics
        const stmt = db.prepare(`
            SELECT * FROM stock_risk_metrics 
            WHERE symbol = ?
        `);
        stmt.bind([symbol]);
        
        let metrics = null;
        if (stmt.step()) {
            metrics = stmt.getAsObject();
        }
        stmt.free();
        
        if (!metrics) {
            document.getElementById('stock-metrics').innerHTML = `
                <div class="error">
                    No risk metrics found for ${symbol}. Run R scripts to calculate metrics.
                </div>
            `;
            return;
        }
        
        // Display metrics
        const annualizedReturn = (metrics.mean_return * 252 * 100).toFixed(4);
        const volatility = (metrics.volatility * 100).toFixed(2);
        const sharpeRatio = metrics.sharpe_ratio ? metrics.sharpe_ratio.toFixed(3) : 'N/A';
        const maxDrawdown = (metrics.max_drawdown * 100).toFixed(2);
        const var95 = (metrics.var_95 * 100).toFixed(2);
        const beta = metrics.beta ? metrics.beta.toFixed(3) : 'N/A';
        const observations = metrics.observations || 0;
        
        document.getElementById('stock-metrics').innerHTML = `
            <div class="metrics-grid">
                <div class="metric-card">
                    <h3>Annualized Return</h3>
                    <p>${annualizedReturn}%</p>
                    <span class="label">Yearly Average</span>
                </div>
                <div class="metric-card">
                    <h3>Annualized Volatility</h3>
                    <p>${volatility}%</p>
                    <span class="label">Risk Measure</span>
                </div>
                <div class="metric-card">
                    <h3>Sharpe Ratio</h3>
                    <p>${sharpeRatio}</p>
                    <span class="label">Risk-Adjusted Return</span>
                </div>
                <div class="metric-card">
                    <h3>Max Drawdown</h3>
                    <p>${maxDrawdown}%</p>
                    <span class="label">Worst Loss</span>
                </div>
                <div class="metric-card">
                    <h3>VaR (95%)</h3>
                    <p>${var95}%</p>
                    <span class="label">Value at Risk</span>
                </div>
                <div class="metric-card">
                    <h3>Beta</h3>
                    <p>${beta}</p>
                    <span class="label">Market Sensitivity</span>
                </div>
                <div class="metric-card">
                    <h3>Observations</h3>
                    <p>${observations}</p>
                    <span class="label">Data Points</span>
                </div>
            </div>
        `;
        
        // Load price history
        loadStockPriceHistory(symbol);
        
    } catch (err) {
        console.error("Error loading stock metrics:", err);
        document.getElementById('stock-metrics').innerHTML = `
            <div class="error">
                <strong>Error loading metrics:</strong> ${err.message}
            </div>
        `;
    } finally {
        hideLoading();
    }
}

// Load price history for stock
function loadStockPriceHistory(symbol) {
    try {
        const stmt = db.prepare(`
            SELECT date, adjusted_close as price 
            FROM prices 
            WHERE symbol = ? 
            ORDER BY date
        `);
        stmt.bind([symbol]);
        
        const dates = [];
        const prices = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            dates.push(row.date);
            prices.push(row.price);
        }
        stmt.free();
        
        if (dates.length === 0) {
            document.getElementById('stock-price-chart').innerHTML = '<div class="error">No price data found</div>';
            return;
        }
        
        // Create price chart
        const priceTrace = {
            x: dates,
            y: prices,
            type: 'scatter',
            mode: 'lines',
            name: symbol,
            line: { color: '#C0432B', width: 2 }  // Tunnel's --route color
        };
        
        const priceLayout = {
            title: `${symbol} Price History`,
            xaxis: { title: 'Date' },
            yaxis: { title: 'Price ($)' },
            hovermode: 'x unified',
            plot_bgcolor: '#EDE7D3',
            paper_bgcolor: '#EDE7D3',
            font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
        };
        
        Plotly.newPlot('stock-price-chart', [priceTrace], priceLayout, {responsive: true});
        
        // Calculate and plot returns
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
        }
        
        const returnDates = dates.slice(1);
        
        const returnTrace = {
            x: returnDates,
            y: returns,
            type: 'scatter',
            mode: 'lines',
            name: 'Daily Returns',
            line: { color: '#3E7C8C', width: 1 }  // Tunnel's --incident color
        };
        
        const returnLayout = {
            title: `${symbol} Daily Returns (%)`,
            xaxis: { title: 'Date' },
            yaxis: { title: 'Return (%)' },
            hovermode: 'x unified',
            plot_bgcolor: '#EDE7D3',
            paper_bgcolor: '#EDE7D3',
            font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
        };
        
        Plotly.newPlot('stock-returns-chart', [returnTrace], returnLayout, {responsive: true});
        
    } catch (err) {
        console.error("Error loading price history:", err);
        document.getElementById('stock-price-chart').innerHTML = `
            <div class="error">
                <strong>Error loading price history:</strong> ${err.message}
            </div>
        `;
    }
}

// Run custom SQL query
function runQuery() {
    const query = document.getElementById('sql-query').value;
    const resultsDiv = document.getElementById('query-results');
    
    if (!query.trim()) {
        resultsDiv.innerHTML = '<div class="error">Please enter a query</div>';
        return;
    }
    
    resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><h4>Executing query <span class="loading"></span></h4></div>';
    
    try {
        const startTime = performance.now();
        const stmt = db.prepare(query);
        const columns = stmt.getColumnNames();
        const rows = [];
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            rows.push(row);
        }
        stmt.free();
        
        const endTime = performance.now();
        const executionTime = (endTime - startTime).toFixed(2);
        
        // Display results
        if (rows.length === 0) {
            resultsDiv.innerHTML = `
                <div class="info">
                    <strong>Query executed successfully in ${executionTime}ms</strong><br>
                    No results returned.
                </div>
            `;
            return;
        }
        
        let html = `<div class="success">
            <strong>Query executed successfully in ${executionTime}ms</strong>
            <span style="float: right;">${rows.length} rows returned</span>
        </div>
        <table>
            <thead><tr>`;
        
        columns.forEach(col => {
            html += `<th>${col}</th>`;
        });
        
        html += '</tr></thead><tbody>';
        
        // Limit to first 1000 rows for display
        const displayRows = rows.slice(0, 1000);
        
        displayRows.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                let value = row[col];
                if (value === null || value === undefined) {
                    value = '<em>NULL</em>';
                } else if (typeof value === 'number') {
                    value = Number(value.toFixed(6));
                }
                html += `<td>${value}</td>`;
            });
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        
        if (rows.length > 1000) {
            html += `<div class="info">Showing first 1000 of ${rows.length} rows</div>`;
        }
        
        resultsDiv.innerHTML = html;
        
    } catch (err) {
        resultsDiv.innerHTML = `
            <div class="error">
                <strong>Query Error:</strong> ${err.message}
            </div>
        `;
    }
}

// Clear query
function clearQuery() {
    document.getElementById('sql-query').value = '';
    document.getElementById('query-results').innerHTML = '';
}

// Populate the editor from an example chip and run it immediately
function setQuery(query) {
    const textarea = document.getElementById('sql-query');
    textarea.value = query;
    textarea.focus();
    runQuery();
}

// ===========================================================================
// Build Your Own Portfolio — everything below runs client-side from the
// in-browser SQLite price history.
// ===========================================================================

let myHoldings = [];            // [{symbol, weight}]
const returnsCache = {};        // symbol -> Map(date -> daily return)
let marketReturnsCache = null;  // Map(date -> equal-weight market return)
let lastPortfolioReturns = null; // daily returns of the last calculated portfolio

// --- small stats helpers (mirror python/fetch_real_data.py) ---
function pfMean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function pfPstdev(a) {
    if (a.length < 1) return 0;
    const m = pfMean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
}
function pfPercentile(a, p) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const r = (p / 100) * (s.length - 1);
    const lo = Math.floor(r), hi = Math.ceil(r);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (r - lo);
}
function pfMaxDrawdown(rets) {
    let c = 1, peak = 1, worst = 0;
    rets.forEach(r => { c *= (1 + r); peak = Math.max(peak, c); worst = Math.min(worst, (c - peak) / peak); });
    return worst;
}
function pfCovariance(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const mx = pfMean(x), my = pfMean(y);
    let s = 0;
    for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
    return s / n;
}

// Daily returns for a symbol as a Map(date -> return). Cached.
function getReturnSeries(symbol) {
    if (returnsCache[symbol]) return returnsCache[symbol];
    const map = new Map();
    try {
        const stmt = db.prepare(
            "SELECT date, adjusted_close AS price FROM prices WHERE symbol = ? ORDER BY date");
        stmt.bind([symbol]);
        const dates = [], prices = [];
        while (stmt.step()) { const r = stmt.getAsObject(); dates.push(r.date); prices.push(r.price); }
        stmt.free();
        for (let i = 1; i < prices.length; i++) {
            if (prices[i - 1]) map.set(dates[i], (prices[i] - prices[i - 1]) / prices[i - 1]);
        }
    } catch (err) {
        console.error(`Could not load prices for ${symbol}:`, err);
    }
    returnsCache[symbol] = map;
    return map;
}

// Equal-weighted market return per date, across every stock with price data.
function getMarketReturns() {
    if (marketReturnsCache) return marketReturnsCache;
    const sum = new Map(), count = new Map();
    allStocks.forEach(s => {
        getReturnSeries(s.symbol).forEach((r, d) => {
            sum.set(d, (sum.get(d) || 0) + r);
            count.set(d, (count.get(d) || 0) + 1);
        });
    });
    marketReturnsCache = new Map();
    sum.forEach((v, d) => marketReturnsCache.set(d, v / count.get(d)));
    return marketReturnsCache;
}

// Render the editable holdings table.
function renderHoldings() {
    const div = document.getElementById('builder-holdings');
    if (!div) return;
    if (myHoldings.length === 0) {
        div.innerHTML = '<p class="holdings-empty">No stocks yet — add some above, or ' +
            'try <strong>Load sample</strong>.</p>';
        return;
    }
    const total = myHoldings.reduce((a, h) => a + (h.weight || 0), 0);
    let html = '<table class="holdings-table"><thead><tr>' +
        '<th>Symbol</th><th>Name</th><th>Sector</th><th>Weight</th>' +
        '<th>Normalised</th><th></th></tr></thead><tbody>';
    myHoldings.forEach((h, i) => {
        const info = stockInfoMap[h.symbol] || {};
        const pct = total > 0 ? (h.weight / total * 100) : 0;
        html += `<tr>
            <td><strong>${h.symbol}</strong></td>
            <td>${info.name || ''}</td>
            <td>${info.sector || ''}</td>
            <td><input type="number" min="0" step="1" value="${h.weight}" class="weight-input"
                       onchange="updateHoldingWeight(${i}, this.value)"></td>
            <td>${pct.toFixed(1)}%</td>
            <td><button class="btn remove-btn" onclick="removeHolding(${i})" title="Remove">✕</button></td>
        </tr>`;
    });
    html += `</tbody><tfoot><tr><td colspan="3">${myHoldings.length} holding(s)</td>` +
        `<td>${total.toFixed(0)}</td><td>100%</td><td></td></tr></tfoot></table>`;
    div.innerHTML = html;
}

function addHolding() {
    const sel = document.getElementById('builder-stock');
    const weightInput = document.getElementById('builder-weight');
    const symbol = sel.value;
    if (!symbol) return;
    const weight = Math.max(0, parseFloat(weightInput.value) || 0);
    const existing = myHoldings.find(h => h.symbol === symbol);
    if (existing) {
        existing.weight = weight;  // re-adding updates the weight
    } else {
        myHoldings.push({ symbol, weight });
    }
    sel.value = '';
    renderHoldings();
}

function updateHoldingWeight(index, value) {
    if (myHoldings[index]) {
        myHoldings[index].weight = Math.max(0, parseFloat(value) || 0);
        renderHoldings();
    }
}

function removeHolding(index) {
    myHoldings.splice(index, 1);
    renderHoldings();
}

function clearHoldings() {
    myHoldings = [];
    lastPortfolioReturns = null;
    renderHoldings();
    document.getElementById('builder-results').innerHTML = '';
    document.getElementById('builder-charts').style.display = 'none';
    const mc = document.getElementById('mc-section');
    if (mc) mc.style.display = 'none';
}

function equalWeightHoldings() {
    myHoldings.forEach(h => { h.weight = 100 / Math.max(1, myHoldings.length); });
    renderHoldings();
}

// Load the built-in sample portfolio so users have a starting point.
function loadSamplePortfolio() {
    myHoldings = [
        { symbol: 'AAPL', weight: 32 },
        { symbol: 'MSFT', weight: 53 },
        { symbol: 'GOOGL', weight: 11 },
        { symbol: 'AMZN', weight: 4 }
    ].filter(h => stockInfoMap[h.symbol]);  // only those present in the DB
    renderHoldings();
}

// Compute and display risk for the current holdings.
function calculatePortfolio() {
    const results = document.getElementById('builder-results');
    const charts = document.getElementById('builder-charts');

    const active = myHoldings.filter(h => h.weight > 0);
    if (active.length === 0) {
        results.innerHTML = '<div class="info">Add at least one stock with a weight above zero.</div>';
        charts.style.display = 'none';
        return;
    }

    // Drop any holdings that have no price history (e.g. not yet fetched).
    const withData = [], missing = [];
    active.forEach(h => {
        (getReturnSeries(h.symbol).size > 0 ? withData : missing).push(h.symbol);
    });
    const usable = active.filter(h => withData.includes(h.symbol));
    if (usable.length === 0) {
        results.innerHTML = '<div class="error">None of the selected stocks have price ' +
            'history in the database yet. Try others, or wait for the next data refresh.</div>';
        charts.style.display = 'none';
        return;
    }

    // Normalise weights and intersect the dates the holdings share.
    const totalW = usable.reduce((a, h) => a + h.weight, 0);
    const norm = usable.map(h => ({ symbol: h.symbol, w: h.weight / totalW, m: getReturnSeries(h.symbol) }));
    let common = null;
    norm.forEach(h => {
        const ds = new Set(h.m.keys());
        common = common === null ? ds : new Set([...common].filter(d => ds.has(d)));
    });
    const dates = [...common].sort();
    if (dates.length < 30) {
        results.innerHTML = '<div class="error">Not enough overlapping price history between ' +
            'these stocks to compute meaningful risk.</div>';
        charts.style.display = 'none';
        return;
    }

    const rets = dates.map(d => norm.reduce((a, h) => a + h.w * h.m.get(d), 0));

    // Metrics (same definitions as the per-stock metrics).
    const std = pfPstdev(rets);
    const annReturn = pfMean(rets) * 252 * 100;
    const volatility = std * Math.sqrt(252) * 100;
    const sharpe = std ? pfMean(rets) / std * Math.sqrt(252) : null;
    const maxDD = pfMaxDrawdown(rets) * 100;
    const var95 = pfPercentile(rets, 5) * 100;

    // Beta vs the equal-weight market over the same dates.
    const market = getMarketReturns();
    const mktVals = dates.map(d => market.get(d)).filter(v => v !== undefined);
    const mktVar = pfPstdev(mktVals) ** 2;
    const beta = mktVar ? pfCovariance(rets, mktVals) / mktVar : null;

    const fmt = (v, d = 2) => (v === null || isNaN(v)) ? 'N/A' : v.toFixed(d);
    results.innerHTML = `
        <div class="metrics-grid">
            <div class="metric-card"><h3>Annualized Return</h3><p>${fmt(annReturn)}%</p><span class="label">Reward</span></div>
            <div class="metric-card"><h3>Annualized Volatility</h3><p>${fmt(volatility)}%</p><span class="label">Risk</span></div>
            <div class="metric-card"><h3>Sharpe Ratio</h3><p>${fmt(sharpe)}</p><span class="label">Reward per Risk</span></div>
            <div class="metric-card"><h3>Max Drawdown</h3><p>${fmt(maxDD)}%</p><span class="label">Worst Loss</span></div>
            <div class="metric-card"><h3>VaR (95%)</h3><p>${fmt(var95)}%</p><span class="label">Bad-day Loss</span></div>
            <div class="metric-card"><h3>Beta</h3><p>${fmt(beta, 3)}</p><span class="label">Market Sensitivity</span></div>
        </div>
        <div class="info"><strong>Based on</strong> ${dates.length.toLocaleString()} trading days
            (${dates[0]} to ${dates[dates.length - 1]}) across ${usable.length} holding(s).
            ${missing.length ? `<br><em>Skipped (no price data yet): ${missing.join(', ')}.</em>` : ''}
        </div>`;

    charts.style.display = '';
    drawGrowthChart(dates, rets, market);
    drawAllocationChart(norm);

    // Enable the Monte Carlo section now that we have a portfolio return series.
    lastPortfolioReturns = rets;
    const mc = document.getElementById('mc-section');
    if (mc) mc.style.display = '';
}

// --- Monte Carlo simulation ---
// Standard normal via Box-Muller.
function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Linear-interpolated quantile of an already-sorted ascending array.
function quantileSorted(sorted, q) {
    if (!sorted.length) return 0;
    const r = (q / 100) * (sorted.length - 1);
    const lo = Math.floor(r), hi = Math.ceil(r);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}

function runMonteCarlo() {
    const out = document.getElementById('mc-results');
    if (!lastPortfolioReturns || lastPortfolioReturns.length < 30) {
        out.innerHTML = '<div class="info">Calculate a portfolio above first.</div>';
        return;
    }
    const rets = lastPortfolioReturns;
    const method = document.getElementById('mc-method').value;
    const steps = parseInt(document.getElementById('mc-horizon').value, 10);
    const nPaths = parseInt(document.getElementById('mc-paths').value, 10);
    const start = Math.max(1, parseFloat(document.getElementById('mc-start').value) || 10000);

    // Calibrate GBM on log returns (daily dt).
    const logrets = rets.map(r => Math.log(1 + r));
    const muL = pfMean(logrets), sigL = pfPstdev(logrets);

    // Simulate. Keep every path's value at every step for the fan chart.
    const stepValues = Array.from({ length: steps + 1 }, () => new Float64Array(nPaths));
    const finals = new Float64Array(nPaths);
    for (let p = 0; p < nPaths; p++) {
        let v = start;
        stepValues[0][p] = v;
        for (let t = 1; t <= steps; t++) {
            const stepRet = method === 'gbm'
                ? Math.exp(muL + sigL * gaussian()) - 1
                : rets[(Math.random() * rets.length) | 0];
            v *= (1 + stepRet);
            stepValues[t][p] = v;
        }
        finals[p] = v;
    }

    // Percentile bands per step.
    const qs = [5, 25, 50, 75, 95];
    const bands = {}; qs.forEach(q => bands[q] = new Array(steps + 1));
    for (let t = 0; t <= steps; t++) {
        const sorted = Array.from(stepValues[t]).sort((a, b) => a - b);
        qs.forEach(q => bands[q][t] = quantileSorted(sorted, q));
    }

    // Summary on final values.
    const fsorted = Array.from(finals).sort((a, b) => a - b);
    const probLoss = finals.reduce((c, v) => c + (v < start ? 1 : 0), 0) / nPaths * 100;
    const median = quantileSorted(fsorted, 50);
    const p5 = quantileSorted(fsorted, 5);
    const p95 = quantileSorted(fsorted, 95);
    const cut = Math.max(1, Math.floor(nPaths * 0.05));
    const cvar = pfMean(fsorted.slice(0, cut));  // expected shortfall: mean of worst 5%
    const pct = v => ((v / start - 1) * 100).toFixed(1);
    const money = v => '$' + Math.round(v).toLocaleString();

    out.innerHTML = `
        <div class="metrics-grid">
            <div class="metric-card"><h3>Probability of Loss</h3><p>${probLoss.toFixed(1)}%</p><span class="label">Ending below ${money(start)}</span></div>
            <div class="metric-card"><h3>Median Outcome</h3><p>${money(median)}</p><span class="label">${pct(median)}%</span></div>
            <div class="metric-card"><h3>Downside (5th pct)</h3><p>${money(p5)}</p><span class="label">${pct(p5)}% · 95% confident above</span></div>
            <div class="metric-card"><h3>Upside (95th pct)</h3><p>${money(p95)}</p><span class="label">${pct(p95)}%</span></div>
            <div class="metric-card"><h3>Expected Shortfall</h3><p>${money(cvar)}</p><span class="label">Avg of worst 5% (${pct(cvar)}%)</span></div>
        </div>
        <div class="info">${nPaths.toLocaleString()} simulated paths over ${steps} trading days
            (${(steps / 252).toFixed(steps % 252 ? 2 : 0)} yr) via
            ${method === 'gbm' ? 'Geometric Brownian Motion' : 'historical bootstrap'}.</div>`;

    drawFanChart(steps, bands, start);
    drawHistogram(fsorted, start);
}

function drawFanChart(steps, bands, start) {
    const x = Array.from({ length: steps + 1 }, (_, i) => i);
    const band = (color) => ({ fill: 'tonexty', fillcolor: color, line: { width: 0 }, type: 'scatter', mode: 'lines', hoverinfo: 'skip', showlegend: false });
    const traces = [
        { x, y: bands[5], type: 'scatter', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
        Object.assign({ x, y: bands[95], name: '5–95%' }, band('rgba(62,124,140,0.18)')),
        { x, y: bands[25], type: 'scatter', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
        Object.assign({ x, y: bands[75], name: '25–75%' }, band('rgba(62,124,140,0.32)')),
        { x, y: bands[50], type: 'scatter', mode: 'lines', name: 'Median', line: { color: '#C0432B', width: 2 } }
    ];
    Plotly.newPlot('mc-fan-chart', traces, Object.assign({}, BASE_LAYOUT, {
        title: 'Projected portfolio value',
        xaxis: { title: 'Trading days ahead' },
        yaxis: { title: 'Value ($)' }
    }), { responsive: true });
}

function drawHistogram(fsorted, start) {
    const traces = [{ x: Array.from(fsorted), type: 'histogram', marker: { color: '#3E7C8C' }, nbinsx: 50, hovertemplate: '%{x:$,.0f}<br>%{y} paths<extra></extra>' }];
    Plotly.newPlot('mc-hist-chart', traces, Object.assign({}, BASE_LAYOUT, {
        title: 'Distribution of final values',
        showlegend: false,
        xaxis: { title: 'Final value ($)' },
        yaxis: { title: 'Number of paths' },
        shapes: [{ type: 'line', x0: start, x1: start, yref: 'paper', y0: 0, y1: 1, line: { color: '#4A3823', width: 1.5, dash: 'dot' } }]
    }), { responsive: true });
}

// Cumulative growth of $10,000, portfolio vs equal-weight market benchmark.
function drawGrowthChart(dates, rets, market) {
    let pv = 10000, bv = 10000;
    const portfolio = [], benchmark = [];
    dates.forEach((d, i) => {
        pv *= (1 + rets[i]);
        const mr = market.get(d);
        bv *= (1 + (mr === undefined ? 0 : mr));
        portfolio.push(pv);
        benchmark.push(bv);
    });

    const traces = [
        {
            x: dates, y: portfolio, type: 'scatter', mode: 'lines', name: 'Your portfolio',
            line: { color: '#C0432B', width: 2 }
        },
        {
            x: dates, y: benchmark, type: 'scatter', mode: 'lines', name: 'Equal-weight market',
            line: { color: '#3E7C8C', width: 1.5, dash: 'dot' }
        }
    ];
    Plotly.newPlot('builder-growth-chart', traces, Object.assign({}, BASE_LAYOUT, {
        title: 'Growth of $10,000',
        xaxis: { title: 'Date' },
        yaxis: { title: 'Value ($)' },
        hovermode: 'x unified'
    }), { responsive: true });
}

// Doughnut of normalised weight by sector.
function drawAllocationChart(norm) {
    const bySector = {};
    norm.forEach(h => {
        const sector = (stockInfoMap[h.symbol] || {}).sector || 'Other';
        bySector[sector] = (bySector[sector] || 0) + h.w * 100;
    });
    const labels = Object.keys(bySector).sort();
    const trace = [{
        type: 'pie', hole: 0.45,
        labels: labels,
        values: labels.map(s => bySector[s]),
        marker: { colors: labels.map(s => sectorColor(s)) },
        textinfo: 'label+percent',
        hovertemplate: '%{label}<br>%{value:.1f}%<extra></extra>'
    }];
    Plotly.newPlot('builder-allocation-chart', trace, Object.assign({}, BASE_LAYOUT, {
        title: 'Allocation by Sector'
    }), { responsive: true });
}

// Tab switching
function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    
    // Remove active class from all buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const activeTab = document.getElementById(tabName);
    activeTab.style.display = 'block';

    // Plotly charts rendered while their tab was hidden (width 0) don't size to
    // their container; resize them now that the tab is visible.
    if (typeof Plotly !== 'undefined') {
        activeTab.querySelectorAll('.js-plotly-plot').forEach(plot => {
            try { Plotly.Plots.resize(plot); } catch (e) { /* not yet drawn */ }
        });
    }

    // Add active class to clicked button
    if (typeof event !== 'undefined' && event.target) {
        event.target.classList.add('active');
    }
}

// Initialize Tunnel signature figures
function initTunnelSignature() {
    try {
        // Check if TunnelFigure is available
        if (typeof TunnelFigure !== 'undefined') {
            // The fixed house logo in the masthead (seed ignored - same on every page)
            const sigElement = document.getElementById('sig');
            if (sigElement) {
                sigElement.innerHTML = TunnelFigure.tunnelFigureSVG(null, { variant: 'mark' });
            }
            
            // The fixed house logo in the footer (seed ignored - same on every page)
            const sigFooterElement = document.getElementById('sig-footer');
            if (sigFooterElement) {
                sigFooterElement.innerHTML = TunnelFigure.tunnelFigureSVG(null, { variant: 'mark' });
            }
            
            // The per-page doodle: seeded from the page, so it's unique here but stable on reload
            const doodleElement = document.getElementById('doodle');
            if (doodleElement) {
                const seed = document.body.dataset.seed || location.pathname || document.title;
                doodleElement.innerHTML = TunnelFigure.tunnelFigureSVG(seed, { variant: 'doodle' });
                TunnelFigure.placeDoodle(doodleElement);
            }
            
            console.log("Tunnel signature initialized");
        } else {
            console.warn("TunnelFigure not available - signature will not be displayed");
        }
    } catch (err) {
        console.error("Error initializing Tunnel signature:", err);
    }
}

// Initialize on page load
window.onload = function() {
    // Initialize Tunnel signature first
    initTunnelSignature();
    
    // Then load the database
    loadDatabase().catch(err => {
        console.error("Failed to initialize dashboard:", err);
        document.body.innerHTML = '<div class="error" style="text-align: center; padding: 50px;">' +
                                   '<h1>Error loading dashboard</h1>' +
                                   '<p>Could not load database. Please check console for details.</p>' +
                                   '<p><small>Make sure to run the Python and R scripts first to generate the database.</small></p>' +
                                   '</div>';
    });
};
