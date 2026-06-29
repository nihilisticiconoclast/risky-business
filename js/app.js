// Global variables
let db = null;
let stockData = [];
let portfolioData = [];

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
        
        const stmt = db.prepare("SELECT DISTINCT symbol, name FROM stocks ORDER BY symbol");
        const stocks = [];
        while (stmt.step()) {
            // getAsObject() returns a {column: value} object; get() returns a
            // positional array, which is why named access used to be undefined.
            const row = stmt.getAsObject();
            stocks.push(row);
        }
        stmt.free();
        
        const select = document.getElementById('stock-select');
        if (!select) {
            console.error("stock-select element not found");
            return;
        }
        
        select.innerHTML = '<option value="">-- Select a stock --</option>';
        
        stocks.forEach(stock => {
            const option = document.createElement('option');
            // Use lowercase property names as sql.js returns them
            const symbol = stock.symbol || stock.SYMBOL || 'Unknown';
            const name = stock.name || stock.NAME || 'Unknown';
            option.value = symbol;
            option.textContent = `${symbol} - ${name}`;
            select.appendChild(option);
        });
        
        console.log(`Loaded ${stocks.length} stocks`);
    } catch (err) {
        console.error("Error loading stock list:", err);
    }
}

// Load all stock metrics for portfolio tab
function loadAllStockMetrics() {
    try {
        if (!db) {
            console.error("Database not initialized");
            return;
        }
        
        const stmt = db.prepare("SELECT * FROM stock_risk_metrics ORDER BY symbol");
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

// Create portfolio charts using Plotly.js
function createPortfolioCharts() {
    if (stockData.length === 0) return;
    
    // Volatility chart
    const volatilityData = [{
        x: stockData.map(s => s.symbol),
        y: stockData.map(s => s.volatility * 100),
        type: 'bar',
        marker: {
            color: '#C0432B',  // Using Tunnel's --route color
            line: { color: '#4A3823', width: 1 }  // Using Tunnel's --ink color
        },
        text: stockData.map(s => `${(s.volatility * 100).toFixed(2)}%<br>Obs: ${s.observations}`),
        hoverinfo: 'text+y'
    }];
    
    const volatilityLayout = {
        title: 'Annualized Volatility by Stock',
        xaxis: { title: 'Stock' },
        yaxis: { title: 'Volatility (%)' },
        showlegend: false,
        plot_bgcolor: '#EDE7D3',  // Tunnel's --paper
        paper_bgcolor: '#EDE7D3',
        font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
    };
    
    Plotly.newPlot('volatility-chart', volatilityData, volatilityLayout, {responsive: true});
    
    // Sharpe ratio chart
    const sharpeData = [{
        x: stockData.map(s => s.symbol),
        y: stockData.map(s => s.sharpe_ratio || 0),
        type: 'bar',
        marker: {
            color: stockData.map(s => s.sharpe_ratio || 0),
            colorscale: [[0, '#C0432B'], [0.5, '#EDE7D3'], [1, '#3E7C8C']],
            showscale: true,
            colorbar: { title: 'Sharpe Ratio' }
        },
        text: stockData.map(s => `${(s.sharpe_ratio || 0).toFixed(2)}<br>Obs: ${s.observations}`),
        hoverinfo: 'text+y'
    }];
    
    const sharpeLayout = {
        title: 'Sharpe Ratio by Stock',
        xaxis: { title: 'Stock' },
        yaxis: { title: 'Sharpe Ratio' },
        showlegend: false,
        plot_bgcolor: '#EDE7D3',
        paper_bgcolor: '#EDE7D3',
        font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
    };
    
    Plotly.newPlot('sharpe-chart', sharpeData, sharpeLayout, {responsive: true});
    
    // Max drawdown chart
    const drawdownData = [{
        x: stockData.map(s => s.symbol),
        y: stockData.map(s => s.max_drawdown * 100),
        type: 'bar',
        marker: {
            color: '#C0432B',
            line: { color: '#4A3823', width: 1 }
        },
        text: stockData.map(s => `${(s.max_drawdown * 100).toFixed(2)}%<br>Obs: ${s.observations}`),
        hoverinfo: 'text+y'
    }];
    
    const drawdownLayout = {
        title: 'Maximum Drawdown by Stock',
        xaxis: { title: 'Stock' },
        yaxis: { title: 'Max Drawdown (%)' },
        showlegend: false,
        plot_bgcolor: '#EDE7D3',
        paper_bgcolor: '#EDE7D3',
        font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
    };
    
    Plotly.newPlot('drawdown-chart', drawdownData, drawdownLayout, {responsive: true});
    
    // Risk-return scatter plot
    const scatterData = [{
        x: stockData.map(s => (s.mean_return * 252 * 100)),
        y: stockData.map(s => s.volatility * 100),
        mode: 'markers+text',
        type: 'scatter',
        text: stockData.map(s => s.symbol),
        textposition: 'top center',
        textfont: { size: 12, family: 'IBM Plex Mono, monospace' },
        marker: {
            size: stockData.map(s => Math.max(10, s.observations / 50)),
            color: stockData.map(s => s.sharpe_ratio || 0),
            colorscale: 'Viridis',
            showscale: true,
            colorbar: { title: 'Sharpe Ratio' },
            line: { color: '#4A3823', width: 1 }
        },
        hoverinfo: 'text+x+y+name'
    }];
    
    const scatterLayout = {
        title: 'Risk-Return Profile',
        xaxis: { title: 'Annualized Return (%)' },
        yaxis: { title: 'Annualized Volatility (%)' },
        showlegend: false,
        plot_bgcolor: '#EDE7D3',
        paper_bgcolor: '#EDE7D3',
        font: { family: 'Public Sans, sans-serif', color: '#4A3823' }
    };
    
    Plotly.newPlot('risk-return-scatter', scatterData, scatterLayout, {responsive: true});
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
    document.getElementById(tabName).style.display = 'block';
    
    // Add active class to clicked button
    event.target.classList.add('active');
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
