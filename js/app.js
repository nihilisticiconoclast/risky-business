// Global variables
let db = null;
let stockData = [];
let portfolioData = [];

// Initialize sql.js
async function initSqlJsLib() {
    try {
        // For sql-wasm.js from sql.js.org CDN
        const SQL = await initSqlJs({
            locateFile: file => `https://sql.js.org/dist/${file}`
        });
        return SQL;
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
        loadStockList();
        loadPortfolioSummary();
        loadAllStockMetrics();
        
    } catch (err) {
        console.error("Failed to load database:", err);
        document.getElementById('portfolio-summary').innerHTML = `
            <div class="error">
                <strong>Error loading database:</strong> ${err.message}<br>
                Please ensure the database file exists at data/processed/finance_data.sqlite
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
            tab.innerHTML = '<div style="text-align: center; padding: 50px;"><h3>Loading data <span class="loading"></span></h3></div>' + tab.innerHTML;
        }
    });
}

// Hide loading indicator
function hideLoading() {
    document.querySelectorAll('.loading').forEach(el => el.remove());
}

// Load stock list for dropdown
function loadStockList() {
    try {
        const stmt = db.prepare("SELECT DISTINCT symbol, name FROM stocks ORDER BY symbol");
        const stocks = [];
        while (stmt.step()) {
            const row = stmt.get();
            stocks.push(row);
        }
        stmt.free();
        
        const select = document.getElementById('stock-select');
        select.innerHTML = '<option value="">-- Select a stock --</option>';
        
        stocks.forEach(stock => {
            const option = document.createElement('option');
            option.value = stock.symbol;
            option.textContent = `${stock.symbol} - ${stock.name || stock.symbol}`;
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
        const stmt = db.prepare("SELECT * FROM stock_risk_metrics ORDER BY symbol");
        stockData = [];
        while (stmt.step()) {
            stockData.push(stmt.get());
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
        const stmt = db.prepare(`
            SELECT * FROM portfolio_risk_metrics 
            WHERE portfolio_id = 1
            ORDER BY calculated_at DESC LIMIT 1
        `);
        
        const summaryDiv = document.getElementById('portfolio-summary');
        
        if (stmt.step()) {
            const metrics = stmt.get();
            
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

// Load R-generated visualizations
function loadVisualizations() {
    const vizContainer = document.getElementById('portfolio-visualizations');
    
    const visualizations = [
        { name: 'Portfolio Summary', file: 'r/output/portfolio_summary.html' },
        { name: 'Combined Dashboard', file: 'r/output/dashboard_combined.html' }
    ];
    
    visualizations.forEach(viz => {
        try {
            const frame = document.createElement('iframe');
            frame.src = viz.file;
            frame.style = 'width: 100%; height: 500px; border: none; border-radius: 8px; margin-bottom: 20px;';
            frame.onerror = function() {
                this.style.display = 'none';
            };
            vizContainer.appendChild(frame);
        } catch (err) {
            console.log(`Could not load ${viz.file}:`, err);
        }
    });
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
            color: '#1f77b4',
            line: { color: 'white', width: 1 }
        },
        text: stockData.map(s => `${(s.volatility * 100).toFixed(2)}%<br>Obs: ${s.observations}`),
        hoverinfo: 'text+y'
    }];
    
    const volatilityLayout = {
        title: 'Annualized Volatility by Stock',
        xaxis: { title: 'Stock' },
        yaxis: { title: 'Volatility (%)' },
        showlegend: false
    };
    
    Plotly.newPlot('volatility-chart', volatilityData, volatilityLayout, {responsive: true});
    
    // Sharpe ratio chart
    const sharpeData = [{
        x: stockData.map(s => s.symbol),
        y: stockData.map(s => s.sharpe_ratio || 0),
        type: 'bar',
        marker: {
            color: stockData.map(s => s.sharpe_ratio || 0),
            colorscale: 'RdYlGn',
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
        showlegend: false
    };
    
    Plotly.newPlot('sharpe-chart', sharpeData, sharpeLayout, {responsive: true});
    
    // Max drawdown chart
    const drawdownData = [{
        x: stockData.map(s => s.symbol),
        y: stockData.map(s => s.max_drawdown * 100),
        type: 'bar',
        marker: {
            color: '#d62728',
            line: { color: 'white', width: 1 }
        },
        text: stockData.map(s => `${(s.max_drawdown * 100).toFixed(2)}%<br>Obs: ${s.observations}`),
        hoverinfo: 'text+y'
    }];
    
    const drawdownLayout = {
        title: 'Maximum Drawdown by Stock',
        xaxis: { title: 'Stock' },
        yaxis: { title: 'Max Drawdown (%)' },
        showlegend: false
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
        textfont: { size: 12 },
        marker: {
            size: stockData.map(s => Math.max(10, s.observations / 50)),
            color: stockData.map(s => s.sharpe_ratio || 0),
            colorscale: 'Viridis',
            showscale: true,
            colorbar: { title: 'Sharpe Ratio' },
            line: { color: 'white', width: 1 }
        },
        hoverinfo: 'text+x+y+name'
    }];
    
    const scatterLayout = {
        title: 'Risk-Return Profile',
        xaxis: { title: 'Annualized Return (%)' },
        yaxis: { title: 'Annualized Volatility (%)' },
        showlegend: false
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
            metrics = stmt.get();
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
                    <h3>Mean Daily Return</h3>
                    <p>${annualizedReturn}%</p>
                    <span class="label">Daily Average</span>
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
            const row = stmt.get();
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
            line: { color: '#667eea', width: 2 }
        };
        
        const priceLayout = {
            title: `${symbol} Price History`,
            xaxis: { title: 'Date' },
            yaxis: { title: 'Price ($)' },
            hovermode: 'x unified'
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
            line: { color: '#d62728', width: 1 }
        };
        
        const returnLayout = {
            title: `${symbol} Daily Returns (%)`,
            xaxis: { title: 'Date' },
            yaxis: { title: 'Return (%)' },
            hovermode: 'x unified'
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
            const row = stmt.get();
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

// Initialize on page load
window.onload = function() {
    loadDatabase().catch(err => {
        console.error("Failed to initialize dashboard:", err);
        document.body.innerHTML = '<div class="error" style="text-align: center; padding: 50px;">' +
                                   '<h1>Error loading dashboard</h1>' +
                                   '<p>Could not load database. Please check console for details.</p>' +
                                   '<p><small>Make sure to run the Python and R scripts first to generate the database.</small></p>' +
                                   '</div>';
    });
};
