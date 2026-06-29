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
The full pipeline below is only needed if you want real market data.

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

- **Python**: Data download, cleaning, database operations (yfinance, pandas, sqlite3)
- **R**: Statistical analysis, risk calculations, visualization generation (plotly, PerformanceAnalytics, TTR)
- **SQLite**: Data storage and querying
- **JavaScript**: Interactive dashboard (Plotly.js, sql.js)
- **HTML/CSS**: Dashboard interface
- **GitHub Pages**: Free static hosting

## License

MIT License
