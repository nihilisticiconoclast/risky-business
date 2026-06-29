# Risk Metrics Dashboard

An interactive financial dashboard for analyzing portfolio risk metrics using SQL, R, Python, and JavaScript. Hosted on GitHub Pages with no backend required.

## Features

- **Volatility Analysis**: Annualized volatility for individual stocks and portfolios
- **Risk Metrics**: Sharpe ratio, Value at Risk (VaR), maximum drawdown, Beta
- **Portfolio Analysis**: Aggregate risk metrics for custom portfolios
- **SQL Query Interface**: Run custom queries on financial data
- **Interactive Visualizations**: Plotly.js charts with zoom, pan, and hover details

## Live Demo

[View on GitHub Pages](https://nihilisticiconoclast.github.io/risky-business/)

## Setup

### Quick start (sample data, no external dependencies)

The dashboard ships with a generated sample database, so you can run it
immediately. To regenerate that database from scratch using only the Python
standard library (no `pandas`, `yfinance`, or R required):

```bash
python python/generate_sample_data.py
python -m http.server 8000
# Then open http://localhost:8000
```

This produces the full schema (`stocks`, `prices`, `portfolio_holdings`,
`stock_risk_metrics`, `portfolio_risk_metrics`) with reproducible mock data.

### Real market data (free, no API key)

To replace the mock data with **real** prices and risk metrics computed from
them, run the standalone fetcher (standard library only — no `pandas`,
`yfinance`, or R):

```bash
python python/fetch_real_data.py
python -m http.server 8000
```

This downloads ~3 years of daily prices for the configured tickers from
[Stooq](https://stooq.com), a free source that needs **no API key and no
signup**, then computes volatility, Sharpe ratio, VaR, max drawdown, and beta
directly from the fetched prices and writes the same database schema the
dashboard reads. If the network is unavailable it exits cleanly and leaves the
existing database untouched.

#### Free data providers

| Provider | API key? | Notes |
|----------|----------|-------|
| **Stooq** (default) | No | No signup; daily OHLCV via CSV. Used by `fetch_real_data.py`. |
| Yahoo Finance (`yfinance`) | No | Unofficial; rate-limited/blocked at times. Used by the legacy `download_data.py`. |
| [Alpha Vantage](https://www.alphavantage.co) | Yes (free) | 25 requests/day on the free tier. |
| [Tiingo](https://www.tiingo.com) | Yes (free) | Generous free tier; good EOD history. |
| [Twelve Data](https://twelvedata.com) | Yes (free) | ~800 requests/day on the free tier. |

To switch providers, edit only the `fetch_prices()` function in
`python/fetch_real_data.py` — it is the single provider-specific piece; the
rest of the pipeline is provider-agnostic.

### Prerequisites

- Python 3.8+
- R 4.0+
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nihilisticiconoclast/risky-business.git
   cd risky-business
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
risky-business/
├── data/
│   ├── raw/              # Source CSV files
│   └── processed/        # Cleaned data & SQLite databases
├── python/              # Data pipeline scripts
├── r/                   # R analysis & visualization scripts
│   └── output/           # Generated HTML visualizations
├── js/                  # JavaScript files
├── css/                 # Stylesheets
├── index.html           # Main dashboard
├── README.md
└── .gitignore
```

## Data Sources

- **Stooq** (default for `fetch_real_data.py`): Free daily prices, no API key
- **Yahoo Finance** (legacy `download_data.py`): Historical prices via `yfinance`
- Other free options (Alpha Vantage, Tiingo, Twelve Data) — see
  [Real market data](#real-market-data-free-no-api-key) for the comparison
  table and how to swap providers

## Customization

### Add New Stocks
Edit the `TICKERS` list in `python/fetch_real_data.py` (real data) or
`python/download_data.py` (legacy yfinance path), and add a matching row to
`STOCK_INFO` so the new symbol gets a name/sector.

### Modify Portfolio
Edit the sample portfolio in `python/build_database.py` or create new entries in the SQLite database.

### Add New Metrics
Edit `r/calculate_metrics.R` to include additional risk metrics.

## Technologies Used

- **Python**: Data download, cleaning, database operations (yfinance, pandas, sqlite3)
- **R**: Statistical analysis, risk calculations, visualization generation (plotly, PerformanceAnalytics, TTR)
- **SQLite**: Data storage and querying
- **JavaScript**: Interactive dashboard (Plotly.js, sql.js)
- **HTML/CSS**: Dashboard interface
- **GitHub Pages**: Free static hosting

## License

MIT License
