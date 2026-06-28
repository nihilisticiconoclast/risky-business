# Risk Metrics Dashboard - Handover Document

## Project Overview

**Objective:** Build an interactive Risk Metrics Dashboard that calculates and visualizes portfolio risk metrics (volatility, Value at Risk, Sharpe ratio, drawdowns, beta) using free financial data. The dashboard runs entirely on GitHub Pages with no backend or costly APIs.

**Relevance to Your Role:** Directly applicable to Senior Data Analyst work in finance. Demonstrates SQL querying, statistical analysis in R, data preprocessing in Python, and interactive visualization—all core skills for financial data analysis.

## Technical Architecture

```
Data Sources (Free)
    ↓
Python: Data Download & Preprocessing
    ↓
SQLite Database: Storage & Querying
    ↓
R: Statistical Calculations & Visualization Generation
    ↓
JavaScript/HTML: Interactive Dashboard (GitHub Pages)
    ↓
User: Explores risk metrics via browser
```

## Repository Setup

**Yes, create a new GitHub repository.**

Suggested name: `risk-metrics-dashboard`

Initial structure:
```
risk-metrics-dashboard/
├── .github/
│   └── workflows/ (optional: for automated data updates)
├── data/
│   ├── raw/ (source CSV files)
│   └── processed/ (cleaned data, SQLite databases)
├── python/
│   ├── requirements.txt
│   ├── download_data.py
│   ├── clean_data.py
│   └── build_database.py
├── r/
│   ├── packages.R (or renv/ for dependency management)
│   ├── calculate_metrics.R
│   ├── generate_visualizations.R
│   └── output/ (exported HTML widgets)
├── js/
│   └── app.js
├── css/
│   └── style.css
├── index.html
├── README.md
└── .gitignore
```

## Implementation Plan

### Phase 1: Data Pipeline (Python)

**Objective:** Download free financial data, clean it, and store in SQLite database.

**Files to create:**
- `python/requirements.txt`
- `python/download_data.py`
- `python/clean_data.py`
- `python/build_database.py`

**Required Python Libraries:**
```
yfinance>=0.2.0
pandas>=2.0.0
numpy>=1.24.0
sqlite3 (built-in)
```

**Sample: download_data.py**
```python
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta

# Configuration
TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'V', 'PG', 'DIS']
END_DATE = datetime.today().strftime('%Y-%m-%d')
START_DATE = (datetime.today() - timedelta(days=365*3)).strftime('%Y-%m-%d')  # 3 years

def download_stock_data():
    """Download historical price data for all tickers."""
    all_data = {}
    for ticker in TICKERS:
        stock = yf.Ticker(ticker)
        df = stock.history(start=START_DATE, end=END_DATE)
        df['symbol'] = ticker
        all_data[ticker] = df
    
    # Save individual files
    for ticker, df in all_data.items():
        df.to_csv(f'data/raw/{ticker}_prices.csv')
    
    # Save combined
    combined = pd.concat(all_data.values())
    combined.to_csv('data/raw/all_prices.csv', index=True)
    return combined

if __name__ == '__main__':
    download_stock_data()
```

**Sample: build_database.py**
```python
import sqlite3
import pandas as pd
import os

# Create database
DB_PATH = 'data/processed/finance_data.db'
os.makedirs('data/processed', exist_ok=True)

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Create tables
cursor.execute('''
CREATE TABLE IF NOT EXISTS stocks (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    sector TEXT,
    industry TEXT
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS prices (
    symbol TEXT,
    date TEXT,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INTEGER,
    adjusted_close REAL,
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
''')

cursor.execute('''
CREATE TABLE IF NOT EXISTS portfolio_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER,
    symbol TEXT,
    quantity REAL,
    purchase_date TEXT,
    purchase_price REAL,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
)
''')

# Load sample portfolio
cursor.execute('INSERT OR IGNORE INTO portfolios (name, description) VALUES (?, ?)',
                ('Sample Tech Portfolio', 'Equal-weighted tech stocks'))

sample_holdings = [
    ('AAPL', 100, '2023-01-01', 150.0),
    ('MSFT', 100, '2023-01-01', 250.0),
    ('GOOGL', 50, '2023-01-01', 100.0),
    ('AMZN', 20, '2023-01-01', 100.0),
]

for symbol, qty, date, price in sample_holdings:
    cursor.execute('''
    INSERT INTO portfolio_holdings (portfolio_id, symbol, quantity, purchase_date, purchase_price)
    VALUES (1, ?, ?, ?, ?)
    ''', (symbol, qty, date, price))

# Load price data from CSV
prices_df = pd.read_csv('data/raw/all_prices.csv')
prices_df.to_sql('prices', conn, if_exists='replace', index=False)

conn.commit()
conn.close()
print(f"Database created at {DB_PATH}")
```

### Phase 2: Risk Calculations (R)

**Objective:** Calculate risk metrics from price data and generate interactive visualizations.

**Files to create:**
- `r/calculate_metrics.R`
- `r/generate_visualizations.R`

**Required R Packages:**
```r
# Install once
install.packages(c("plotly", "htmlwidgets", "quantmod", "TTR", 
                   "PerformanceAnalytics", "dplyr", "DBI", "RSQLite"))
```

**Sample: calculate_metrics.R**
```r
library(DBI)
library(RSQLite)
library(dplyr)
library(PerformanceAnalytics)
library(TTR)

# Connect to SQLite database
con <- dbConnect(RSQLite::SQLite(), "../data/processed/finance_data.db")

# Load price data
prices <- dbGetQuery(con, "
    SELECT symbol, date, adjusted_close as price
    FROM prices
    ORDER BY symbol, date
")

# Calculate daily returns
returns <- prices %>%
  group_by(symbol) %>%
  arrange(date) %>%
  mutate(return = price / lag(price) - 1) %>%
  na.omit()

# Calculate risk metrics per stock
risk_metrics <- returns %>%
  group_by(symbol) %>%
  summarise(
    mean_return = mean(return, na.rm = TRUE),
    volatility = sd(return, na.rm = TRUE) * sqrt(252),  # Annualized
    sharpe_ratio = mean(return, na.rm = TRUE) / sd(return, na.rm = TRUE) * sqrt(252),
    max_drawdown = max_drawdown(return),
    var_95 = VaR(return, p = 0.95, method = "historical"),
    beta = cov(return, mean_return) / var(mean_return, na.rm = TRUE),  # Simplified
    observations = n()
  )

# Save to database
dbWriteTable(con, "stock_risk_metrics", risk_metrics, overwrite = TRUE)

# Calculate portfolio-level metrics for sample portfolio
portfolio_returns <- returns %>%
  filter(symbol %in% c("AAPL", "MSFT", "GOOGL", "AMZN")) %>%
  mutate(weight = case_when(
    symbol == "AAPL" ~ 0.25,
    symbol == "MSFT" ~ 0.25,
    symbol == "GOOGL" ~ 0.25,
    symbol == "AMZN" ~ 0.25,
    TRUE ~ 0
  )) %>%
  group_by(date) %>%
  summarise(portfolio_return = sum(return * weight, na.rm = TRUE))

portfolio_risk <- data.frame(
  mean_return = mean(portfolio_returns$portfolio_return, na.rm = TRUE),
  volatility = sd(portfolio_returns$portfolio_return, na.rm = TRUE) * sqrt(252),
  sharpe_ratio = mean(portfolio_returns$portfolio_return, na.rm = TRUE) / 
                 sd(portfolio_returns$portfolio_return, na.rm = TRUE) * sqrt(252),
  max_drawdown = max_drawdown(portfolio_returns$portfolio_return)
)

# Save portfolio metrics
portfolio_risk$portfolio_id <- 1
portfolio_risk$calculated_at <- Sys.Date()
dbWriteTable(con, "portfolio_risk_metrics", portfolio_risk, overwrite = TRUE)

dbDisconnect(con)

# Return data for visualization
list(
  stock_metrics = risk_metrics,
  portfolio_returns = portfolio_returns,
  portfolio_metrics = portfolio_risk
)
```

**Sample: generate_visualizations.R**
```r
library(plotly)
library(htmlwidgets)

# Load data (output from calculate_metrics.R)
source("calculate_metrics.R")
metrics_data <- calculate_metrics()

# 1. Volatility Comparison Bar Chart
vol_plot <- plot_ly(
  metrics_data$stock_metrics,
  x = ~symbol,
  y = ~volatility,
  type = "bar",
  name = "Annualized Volatility",
  marker = list(color = "#1f77b4")
) %>%
  layout(
    title = "Stock Volatility Comparison (Annualized)",
    xaxis = list(title = "Stock"),
    yaxis = list(title = "Volatility")
  )

# 2. Risk-Return Scatter Plot
rr_plot <- plot_ly(
  metrics_data$stock_metrics,
  x = ~mean_return * 252,
  y = ~volatility,
  type = "scatter",
  mode = "markers+text",
  text = ~symbol,
  textposition = "top center",
  marker = list(
    size = ~observations / 10,
    color = ~sharpe_ratio,
    colorscale = "Viridis",
    showscale = TRUE,
    colorbar = list(title = "Sharpe Ratio")
  )
) %>%
  layout(
    title = "Risk-Return Profile",
    xaxis = list(title = "Annualized Return"),
    yaxis = list(title = "Annualized Volatility")
  )

# 3. Portfolio Returns Time Series
pr_plot <- plot_ly(
  metrics_data$portfolio_returns,
  x = ~date,
  y = ~portfolio_return,
  type = "scatter",
  mode = "lines",
  name = "Portfolio Returns",
  line = list(color = "#ff7f0e")
) %>%
  layout(
    title = "Daily Portfolio Returns",
    xaxis = list(title = "Date"),
    yaxis = list(title = "Return")
  )

# 4. Drawdown Chart
dd_plot <- plot_ly(
  metrics_data$portfolio_returns,
  x = ~date,
  y = ~portfolio_return,
  type = "scatter",
  mode = "lines",
  fill = "tozeroy",
  line = list(color = "#d62728")
) %>%
  layout(
    title = "Portfolio Drawdowns",
    xaxis = list(title = "Date"),
    yaxis = list(title = "Return")
  )

# Save HTML widgets
saveWidget(vol_plot, "r/output/volatility_chart.html", selfcontained = TRUE)
saveWidget(rr_plot, "r/output/risk_return_scatter.html", selfcontained = TRUE)
saveWidget(pr_plot, "r/output/portfolio_returns.html", selfcontained = TRUE)
saveWidget(dd_plot, "r/output/portfolio_drawdowns.html", selfcontained = TRUE)

# Create combined dashboard HTML
combined <- list(
  vol_plot,
  rr_plot,
  pr_plot,
  dd_plot
)

saveWidget(
  subplot(combined[[1]], combined[[2]], nrows = 2),
  "r/output/dashboard_combined.html",
  selfcontained = TRUE
)
```

### Phase 3: Interactive Dashboard (JavaScript/HTML)

**Objective:** Create a browser-based interface that loads the SQLite database, runs queries via sql.js, and displays R-generated visualizations.

**Files to create:**
- `index.html`
- `js/app.js`
- `css/style.css`

**Sample: index.html**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Risk Metrics Dashboard</title>
    <link rel="stylesheet" href="css/style.css">
    <!-- Plotly.js from CDN -->
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <!-- sql.js from CDN -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>Risk Metrics Dashboard</h1>
            <p>Interactive financial risk analysis</p>
        </header>

        <nav class="tabs">
            <button class="tab-button active" onclick="showTab('overview')">Overview</button>
            <button class="tab-button" onclick="showTab('stocks')">Stock Analysis</button>
            <button class="tab-button" onclick="showTab('portfolio')">Portfolio</button>
            <button class="tab-button" onclick="showTab('query')">SQL Query</button>
        </nav>

        <div id="overview" class="tab-content">
            <h2>Portfolio Summary</h2>
            <div id="portfolio-summary"></div>
            <div id="portfolio-metrics"></div>
        </div>

        <div id="stocks" class="tab-content" style="display: none;">
            <h2>Individual Stock Risk Metrics</h2>
            <div id="stock-selector">
                <label for="stock-select">Select Stock:</label>
                <select id="stock-select" onchange="loadStockMetrics()">
                    <option value="">-- Select a stock --</option>
                </select>
            </div>
            <div id="stock-metrics"></div>
            <div id="volatility-chart"></div>
        </div>

        <div id="portfolio" class="tab-content" style="display: none;">
            <h2>Portfolio Analysis</h2>
            <div id="risk-return-scatter"></div>
            <div id="portfolio-returns-chart"></div>
            <div id="portfolio-drawdown-chart"></div>
        </div>

        <div id="query" class="tab-content" style="display: none;">
            <h2>Custom SQL Query</h2>
            <div class="query-container">
                <textarea id="sql-query" rows="10" placeholder="SELECT * FROM stock_risk_metrics;"></textarea>
                <button onclick="runQuery()">Run Query</button>
            </div>
            <div id="query-results"></div>
        </div>

        <footer>
            <p>Data: Yahoo Finance | Built with SQL, R, Python, JavaScript</p>
        </footer>
    </div>

    <script src="js/app.js"></script>
</body>
</html>
```

**Sample: js/app.js**
```javascript
// Global variables
let db = null;
let stockData = [];

// Initialize sql.js
async function initSqlJs() {
    try {
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        return SQL;
    } catch (err) {
        console.error("Failed to load sql.js:", err);
        throw err;
    }
}

// Load database
async function loadDatabase() {
    const response = await fetch('data/processed/finance_data.db');
    const dbArrayBuffer = await response.arrayBuffer();
    
    const SQL = await initSqlJs();
    db = new SQL.Database(new Uint8Array(dbArrayBuffer));
    
    console.log("Database loaded successfully");
    loadStockList();
    loadPortfolioSummary();
}

// Load stock list for dropdown
function loadStockList() {
    const stmt = db.prepare("SELECT DISTINCT symbol FROM stocks ORDER BY symbol");
    const stocks = [];
    while (stmt.step()) {
        stocks.push(stmt.get());
    }
    stmt.free();
    
    const select = document.getElementById('stock-select');
    stocks.forEach(stock => {
        const option = document.createElement('option');
        option.value = stock.symbol;
        option.textContent = stock.symbol;
        select.appendChild(option);
    });
}

// Load portfolio summary
function loadPortfolioSummary() {
    const stmt = db.prepare(`
        SELECT * FROM portfolio_risk_metrics 
        WHERE portfolio_id = 1
        ORDER BY calculated_at DESC LIMIT 1
    `);
    
    if (stmt.step()) {
        const metrics = stmt.get();
        document.getElementById('portfolio-summary').innerHTML = `
            <div class="metrics-grid">
                <div class="metric-card">
                    <h3>Annualized Return</h3>
                    <p>${(metrics.mean_return * 100).toFixed(2)}%</p>
                </div>
                <div class="metric-card">
                    <h3>Annualized Volatility</h3>
                    <p>${(metrics.volatility * 100).toFixed(2)}%</p>
                </div>
                <div class="metric-card">
                    <h3>Sharpe Ratio</h3>
                    <p>${metrics.sharpe_ratio.toFixed(2)}</p>
                </div>
                <div class="metric-card">
                    <h3>Max Drawdown</h3>
                    <p>${(metrics.max_drawdown * 100).toFixed(2)}%</p>
                </div>
            </div>
        `;
    }
    stmt.free();
    
    // Load R-generated visualizations
    loadVisualizations();
}

// Load R-generated visualizations
function loadVisualizations() {
    const vizContainer = document.getElementById('portfolio-metrics');
    
    // Embed volatility chart
    const volFrame = document.createElement('iframe');
    volFrame.src = 'r/output/volatility_chart.html';
    volFrame.style = 'width: 100%; height: 400px; border: none;';
    vizContainer.appendChild(volFrame);
}

// Load stock metrics
function loadStockMetrics() {
    const symbol = document.getElementById('stock-select').value;
    if (!symbol) return;
    
    const stmt = db.prepare(`
        SELECT * FROM stock_risk_metrics 
        WHERE symbol = ?
        ORDER BY symbol
    `);
    stmt.bind([symbol]);
    
    if (stmt.step()) {
        const metrics = stmt.get();
        document.getElementById('stock-metrics').innerHTML = `
            <div class="metrics-grid">
                <div class="metric-card">
                    <h3>Mean Daily Return</h3>
                    <p>${(metrics.mean_return * 100).toFixed(4)}%</p>
                </div>
                <div class="metric-card">
                    <h3>Annualized Volatility</h3>
                    <p>${(metrics.volatility * 100).toFixed(2)}%</p>
                </div>
                <div class="metric-card">
                    <h3>Sharpe Ratio</h3>
                    <p>${metrics.sharpe_ratio.toFixed(2)}</p>
                </div>
                <div class="metric-card">
                    <h3>Max Drawdown</h3>
                    <p>${(metrics.max_drawdown * 100).toFixed(2)}%</p>
                </div>
                <div class="metric-card">
                    <h3>VaR (95%)</h3>
                    <p>${(metrics.var_95 * 100).toFixed(2)}%</p>
                </div>
                <div class="metric-card">
                    <h3>Beta</h3>
                    <p>${metrics.beta.toFixed(2)}</p>
                </div>
            </div>
        `;
    }
    stmt.free();
    
    // Load price history for selected stock
    loadStockPriceHistory(symbol);
}

// Load price history for stock
function loadStockPriceHistory(symbol) {
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
    
    // Create Plotly chart
    const trace = {
        x: dates,
        y: prices,
        type: 'scatter',
        mode: 'lines',
        name: symbol
    };
    
    const layout = {
        title: `${symbol} Price History`,
        xaxis: { title: 'Date' },
        yaxis: { title: 'Price ($)' }
    };
    
    Plotly.newPlot('volatility-chart', [trace], layout);
}

// Run custom SQL query
function runQuery() {
    const query = document.getElementById('sql-query').value;
    const resultsDiv = document.getElementById('query-results');
    
    if (!query.trim()) {
        resultsDiv.innerHTML = '<p>Please enter a query</p>';
        return;
    }
    
    try {
        const stmt = db.prepare(query);
        const columns = stmt.getColumnNames();
        const rows = [];
        
        while (stmt.step()) {
            const row = stmt.get();
            rows.push(row);
        }
        stmt.free();
        
        // Display results as table
        if (rows.length === 0) {
            resultsDiv.innerHTML = '<p>No results</p>';
            return;
        }
        
        let html = '<table><thead><tr>';
        columns.forEach(col => {
            html += `<th>${col}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        rows.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                html += `<td>${row[col]}</td>`;
            });
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        resultsDiv.innerHTML = html;
        
    } catch (err) {
        resultsDiv.innerHTML = `<p style="color: red;">Error: ${err.message}</p>`;
    }
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
        document.body.innerHTML = '<h1>Error loading dashboard</h1>' +
                                   '<p>Could not load database. Please check console for details.</p>';
    });
};
```

**Sample: css/style.css**
```css
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #f5f5f5;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 30px;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 10px;
}

header h1 {
    font-size: 2.5em;
    margin-bottom: 10px;
}

.tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 2px solid #ddd;
}

.tab-button {
    padding: 12px 24px;
    background: #f0f0f0;
    border: none;
    border-radius: 5px 5px 0 0;
    cursor: pointer;
    font-size: 1em;
    transition: background 0.3s;
}

.tab-button:hover {
    background: #e0e0e0;
}

.tab-button.active {
    background: white;
    border-bottom: 3px solid #667eea;
    font-weight: bold;
}

.tab-content {
    padding: 20px;
    background: white;
    border-radius: 0 10px 10px 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin: 20px 0;
}

.metric-card {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
}

.metric-card h3 {
    font-size: 0.9em;
    color: #666;
    margin-bottom: 10px;
}

.metric-card p {
    font-size: 1.5em;
    font-weight: bold;
    color: #667eea;
}

#stock-selector {
    margin: 20px 0;
}

#stock-selector select {
    padding: 10px;
    font-size: 1em;
    border: 2px solid #ddd;
    border-radius: 5px;
    width: 300px;
}

.query-container {
    margin: 20px 0;
}

#sql-query {
    width: 100%;
    padding: 15px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
    border: 2px solid #ddd;
    border-radius: 5px;
    resize: vertical;
}

.query-container button {
    margin-top: 10px;
    padding: 12px 24px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 1em;
}

.query-container button:hover {
    background: #5568d3;
}

#query-results {
    margin-top: 20px;
    overflow-x: auto;
}

#query-results table {
    width: 100%;
    border-collapse: collapse;
}

#query-results th,
#query-results td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #ddd;
}

#query-results th {
    background: #f8f9fa;
    font-weight: bold;
}

#query-results tr:hover {
    background: #f5f5f5;
}

footer {
    text-align: center;
    margin-top: 40px;
    padding: 20px;
    color: #666;
    font-size: 0.9em;
}

/* Responsive design */
@media (max-width: 768px) {
    .metrics-grid {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .tab-button {
        padding: 10px 15px;
        font-size: 0.9em;
    }
}
```

### Phase 4: README and Documentation

**File: README.md**

```markdown
# Risk Metrics Dashboard

An interactive financial dashboard for analyzing portfolio risk metrics using SQL, R, Python, and JavaScript. Hosted on GitHub Pages with no backend required.

## Features

- **Volatility Analysis**: Annualized volatility for individual stocks and portfolios
- **Risk Metrics**: Sharpe ratio, Value at Risk (VaR), maximum drawdown
- **Portfolio Analysis**: Aggregate risk metrics for custom portfolios
- **SQL Query Interface**: Run custom queries on financial data
- **Interactive Visualizations**: Plotly.js charts with zoom, pan, and hover details

## Live Demo

[View on GitHub Pages](https://yourusername.github.io/risk-metrics-dashboard/)

## Setup

### Prerequisites

- Python 3.8+
- R 4.0+
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/risk-metrics-dashboard.git
   cd risk-metrics-dashboard
   ```

2. **Set up Python environment:**
   ```bash
   cd python
   pip install -r requirements.txt
   ```

3. **Set up R environment:**
   ```r
   # In R console
   install.packages(c("plotly", "htmlwidgets", "quantmod", "TTR", 
                      "PerformanceAnalytics", "dplyr", "DBI", "RSQLite"))
   ```

4. **Download data and build database:**
   ```bash
   cd python
   python download_data.py
   python build_database.py
   ```

5. **Generate visualizations:**
   ```bash
   cd ../r
   Rscript generate_visualizations.R
   ```

6. **View locally:**
   Open `index.html` in a browser, or run a local server:
   ```bash
   python -m http.server 8000
   # Then open http://localhost:8000
   ```

7. **Deploy to GitHub Pages:**
   - Push all changes to `main` branch
   - Go to Settings > Pages
   - Select `main` branch and `/ (root)` folder
   - Save

## Project Structure

```
risk-metrics-dashboard/
├── data/
│   ├── raw/              # Source CSV files
│   └── processed/        # Cleaned data & SQLite databases
├── python/              # Data pipeline scripts
├── r/                   # R analysis & visualization scripts
├── js/                  # JavaScript files
├── css/                 # Stylesheets
├── index.html           # Main dashboard
├── README.md
└── .gitignore
```

## Data Sources

- **Yahoo Finance**: Historical stock prices (via yfinance)
- **Free tier**: No API keys required for basic functionality

## Customization

### Add New Stocks
Edit `python/download_data.py` and add symbols to the `TICKERS` list.

### Modify Portfolio
Edit the sample portfolio in `python/build_database.py` or create new entries in the SQLite database.

### Add New Metrics
Edit `r/calculate_metrics.R` to include additional risk metrics.

## Technologies Used

- **Python**: Data download, cleaning, database operations
- **R**: Statistical analysis, risk calculations, visualization generation
- **SQLite**: Data storage and querying
- **JavaScript**: Interactive dashboard (Plotly.js, sql.js)
- **HTML/CSS**: Dashboard interface
- **GitHub Pages**: Free static hosting

## License

MIT License
```

## Execution Workflow

### For Initial Setup

1. Create new GitHub repository: `risk-metrics-dashboard`
2. Create the file structure as shown above
3. Add the code from this handover document
4. Run Python scripts to download data and build database
5. Run R scripts to calculate metrics and generate visualizations
6. Test locally
7. Push to GitHub and enable Pages

### For Updates

1. Modify `TICKERS` in `python/download_data.py` to add/remove stocks
2. Run `python/download_data.py` to get fresh data
3. Run `python/build_database.py` to rebuild database
4. Run `r/generate_visualizations.R` to update charts
5. Commit and push changes

## Key Files Summary

| File | Purpose | Language |
|------|---------|----------|
| `python/download_data.py` | Download stock prices from Yahoo Finance | Python |
| `python/build_database.py` | Create SQLite database with schema | Python |
| `r/calculate_metrics.R` | Calculate risk metrics (volatility, VaR, etc.) | R |
| `r/generate_visualizations.R` | Create interactive Plotly charts | R |
| `index.html` | Main dashboard interface | HTML |
| `js/app.js` | Dashboard logic, sql.js integration | JavaScript |
| `css/style.css` | Styling for dashboard | CSS |

## Expected Output

After running all scripts, you should have:
- `data/processed/finance_data.db` (SQLite database)
- `r/output/*.html` (Interactive visualizations)
- A fully functional dashboard accessible at your GitHub Pages URL

## Troubleshooting

**Database not loading:**
- Check that `finance_data.db` exists in `data/processed/`
- Verify the file path in `js/app.js` matches your structure
- Ensure the database file is committed to the repository

**Visualizations not appearing:**
- Check that R scripts ran successfully
- Verify HTML files exist in `r/output/`
- Check browser console for JavaScript errors

**SQL queries failing:**
- Verify table names match those in your database
- Check query syntax (SQLite dialect)
- Test queries in a SQLite browser first

## Next Enhancements

1. **Add more risk metrics**: CVaR, Sortino ratio, tracking error
2. **Portfolio optimization**: Efficient frontier, mean-variance optimization
3. **Time period selection**: Allow users to select date ranges
4. **Multiple portfolios**: Support for comparing different portfolios
5. **Data export**: Allow downloading query results as CSV
6. **Custom stock addition**: UI for adding new stocks
7. **Benchmark comparison**: Compare against S&P 500, Nasdaq

## References

- [yfinance documentation](https://pypi.org/project/yfinance/)
- [Plotly R documentation](https://plotly.com/r/)
- [sql.js GitHub](https://github.com/sql-js/sql.js/)
- [GitHub Pages documentation](https://pages.github.com/)