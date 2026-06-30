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

### Real market data (free)

To replace the mock data with **real** prices and risk metrics computed from
them, run the standalone fetcher (standard library only — no `pandas`,
`yfinance`, or R):

```bash
python python/fetch_real_data.py
python -m http.server 8000
```

It downloads ~10 years of daily prices for the configured tickers, then
computes volatility, Sharpe ratio, VaR, max drawdown, and beta directly from
those prices and writes the same database schema the dashboard reads. If every
provider is unreachable it exits cleanly and leaves the existing database
untouched. (Adjust `YEARS_OF_HISTORY` in the script to change the window.)

The fetcher tries providers in order until one returns data:

1. **Tiingo** — used first when `TIINGO_API_KEY` is set (see below).
2. **Stooq**, then **Yahoo Finance** — keyless fallbacks, handy for local runs.

> **Why a key for automation?** The keyless sources (Stooq, Yahoo) block
> datacenter IPs, so they fail from GitHub Actions runners (HTML block page /
> HTTP 429). A free Tiingo token authenticates you and works from CI. Running
> locally from a home connection, the keyless fallbacks are usually fine.

#### Automatic refresh (GitHub Actions)

`.github/workflows/update-data.yml` runs `fetch_real_data.py` on a schedule
(weekdays, after the US close) and commits the refreshed database back to the
branch, so GitHub Pages always shows current data. You can also trigger it from
the **Actions** tab (*Update market data → Run workflow*).

**One-time setup** — add a free Tiingo token so the scheduled run can fetch:

1. Sign up at [tiingo.com](https://www.tiingo.com) and copy your API token.
2. In the repo: **Settings → Secrets and variables → Actions → New repository
   secret**, name it `TIINGO_API_KEY`, paste the token.

(Scheduled workflows are paused by GitHub after ~60 days of repository
inactivity — push a commit or run it manually to re-enable.)

#### Free data providers

| Provider | API key? | Notes |
|----------|----------|-------|
| [Tiingo](https://www.tiingo.com) | Yes (free) | Used first when `TIINGO_API_KEY` is set. Generous free tier, good EOD history, works from CI. |
| **Stooq** | No | No signup; daily OHLCV via CSV. Keyless fallback; blocks datacenter IPs. |
| Yahoo Finance | No | Keyless fallback (chart API). Rate-limits datacenter IPs. |
| [Twelve Data](https://twelvedata.com) | Yes (free) | ~800 requests/day; alternative keyed option. |
| [Alpha Vantage](https://www.alphavantage.co) | Yes (free) | 25 requests/day on the free tier. |
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

- **Tiingo** (keyed, used first by `fetch_real_data.py` when `TIINGO_API_KEY`
  is set): free daily EOD prices, works from CI
- **Stooq** / **Yahoo Finance**: keyless fallbacks for local runs
- See [Real market data](#real-market-data-free) for the provider comparison
  table and setup

## Customization

### Add New Stocks
Add one `(symbol, name, sector, industry, region)` row to `STOCK_INFO` in
`python/fetch_real_data.py` — the fetch list (`TICKERS`) is derived from it, so
that single edit is enough. The dashboard ships with 47 stocks (35 US plus 12
FTSE 100 names) spanning all 11 S&P sectors, and the charts and stock picker are
grouped by sector. Re-run `python python/fetch_real_data.py` (or the GitHub
Action) to pull the new symbol's history.

> **FTSE 100 / international stocks:** Tiingo's free end-of-day feed is
> US-listed, so the FTSE 100 names are tracked via their US ADRs (e.g.
> `SHEL`, `AZN`, `HSBC`) — priced in USD. To add London-listed tickers
> directly (e.g. `SHEL.L`) you'd need a provider that covers the LSE.

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
