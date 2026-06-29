#!/usr/bin/env python3
"""
Fetch *real* historical price data and build the dashboard's SQLite database.

This is a drop-in, dependency-free alternative to the
download_data.py -> clean_data.py -> build_database.py -> calculate_metrics.R
pipeline. It uses only the Python standard library (urllib, csv, sqlite3,
math) so it needs neither pandas, yfinance, nor R.

Data source: Stooq (https://stooq.com) daily CSV endpoint. Stooq is free,
requires no API key and no signup, and serves split-adjusted daily OHLCV
data for US equities as `<TICKER>.us`.

Usage:
    python python/fetch_real_data.py

If Stooq is unreachable (e.g. a sandboxed/offline environment), the script
exits with a clear message and leaves any existing database untouched, so you
can fall back to `python python/generate_sample_data.py`.

Swapping providers: only `fetch_prices()` is provider-specific. To use a
different free API (Alpha Vantage, Tiingo, Twelve Data, ...), replace that one
function so it returns the same list of row dicts; the rest of the pipeline is
provider-agnostic.
"""

import csv
import io
import math
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

# Configuration ---------------------------------------------------------------
TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'V', 'PG', 'DIS']
YEARS_OF_HISTORY = 10  # Stooq serves decades of free daily history, no key
TRADING_DAYS = 252  # for annualization
REQUEST_DELAY_SECONDS = 1.0  # be polite to Stooq between requests
DB_PATH = 'data/processed/finance_data.db'

STOCK_INFO = [
    ('AAPL', 'Apple Inc.', 'Technology', 'Consumer Electronics'),
    ('MSFT', 'Microsoft Corporation', 'Technology', 'Software'),
    ('GOOGL', 'Alphabet Inc.', 'Technology', 'Internet'),
    ('AMZN', 'Amazon.com Inc.', 'Consumer Discretionary', 'E-commerce'),
    ('META', 'Meta Platforms Inc.', 'Technology', 'Social Media'),
    ('TSLA', 'Tesla Inc.', 'Consumer Discretionary', 'Automotive'),
    ('JPM', 'JPMorgan Chase & Co.', 'Financial Services', 'Banks'),
    ('V', 'Visa Inc.', 'Financial Services', 'Payment Processing'),
    ('PG', 'Procter & Gamble Co.', 'Consumer Staples', 'Household Products'),
    ('DIS', 'The Walt Disney Company', 'Communication Services', 'Entertainment'),
]

SAMPLE_HOLDINGS = [
    (1, 'AAPL', 100, '2023-01-01', 150.0),
    (1, 'MSFT', 100, '2023-01-01', 250.0),
    (1, 'GOOGL', 50, '2023-01-01', 100.0),
    (1, 'AMZN', 20, '2023-01-01', 100.0),
]


# Provider-specific layer -----------------------------------------------------
def fetch_prices(ticker, start_date, end_date):
    """Download daily OHLCV rows for one ticker from Stooq.

    Returns a list of dicts with keys: date, open, high, low, close, volume,
    adjusted_close. Stooq daily data is already split-adjusted, so we use the
    close as the adjusted close (it has no separate dividend/adjusted column).
    Raises urllib.error.URLError on a network/policy failure.
    """
    d1 = start_date.strftime('%Y%m%d')
    d2 = end_date.strftime('%Y%m%d')
    url = (
        f'https://stooq.com/q/d/l/?s={ticker.lower()}.us'
        f'&d1={d1}&d2={d2}&i=d'
    )
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode('utf-8')

    # Stooq returns "No data" (not CSV) when a symbol/range is unavailable.
    if not text.lstrip().lower().startswith('date'):
        raise ValueError(f'Unexpected response for {ticker}: {text[:60]!r}')

    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            close = float(r['Close'])
        except (KeyError, ValueError):
            continue  # skip malformed / blank rows
        rows.append({
            'date': r['Date'],
            'open': float(r.get('Open') or close),
            'high': float(r.get('High') or close),
            'low': float(r.get('Low') or close),
            'close': close,
            'volume': int(float(r.get('Volume') or 0)),
            'adjusted_close': close,
        })
    return rows


# Provider-agnostic metric math (pure stdlib) ---------------------------------
def daily_returns(prices):
    """Simple daily returns from a list of prices (oldest first)."""
    return [(prices[i] - prices[i - 1]) / prices[i - 1]
            for i in range(1, len(prices)) if prices[i - 1]]


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def pstdev(xs):
    """Population standard deviation (matches numpy's default np.std)."""
    if len(xs) < 1:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


def max_drawdown(returns):
    """Worst peak-to-trough decline of the cumulative return curve."""
    if not returns:
        return None
    cumulative = 1.0
    peak = 1.0
    worst = 0.0
    for r in returns:
        cumulative *= (1 + r)
        peak = max(peak, cumulative)
        worst = min(worst, (cumulative - peak) / peak)
    return worst


def percentile(xs, p):
    """Linear-interpolated percentile (p in [0, 100]), like numpy.percentile."""
    if not xs:
        return None
    ys = sorted(xs)
    if len(ys) == 1:
        return ys[0]
    rank = (p / 100) * (len(ys) - 1)
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return ys[int(rank)]
    return ys[lo] + (ys[hi] - ys[lo]) * (rank - lo)


def covariance(xs, ys):
    n = min(len(xs), len(ys))
    if n < 2:
        return 0.0
    mx, my = mean(xs[:n]), mean(ys[:n])
    return sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / n


def variance(xs):
    return pstdev(xs) ** 2


# Database build --------------------------------------------------------------
def create_schema(cursor):
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.executescript('''
    CREATE TABLE IF NOT EXISTS stocks (
        symbol TEXT PRIMARY KEY, name TEXT, sector TEXT, industry TEXT);
    CREATE TABLE IF NOT EXISTS prices (
        symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,
        volume INTEGER, adjusted_close REAL, dividends REAL DEFAULT 0,
        stock_splits REAL DEFAULT 1,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol));
    CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, symbol TEXT,
        quantity REAL, purchase_date TEXT, purchase_price REAL,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
        FOREIGN KEY (symbol) REFERENCES stocks(symbol));
    CREATE TABLE IF NOT EXISTS stock_risk_metrics (
        symbol TEXT PRIMARY KEY, mean_return REAL, volatility REAL,
        sharpe_ratio REAL, max_drawdown REAL, var_95 REAL, beta REAL,
        observations INTEGER, calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol));
    CREATE TABLE IF NOT EXISTS portfolio_risk_metrics (
        portfolio_id INTEGER, mean_return REAL, volatility REAL,
        sharpe_ratio REAL, max_drawdown REAL,
        calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id));
    ''')


def compute_stock_metrics(symbol, returns, market_returns_by_date, dates):
    """Build one stock_risk_metrics row from a series of daily returns."""
    std = pstdev(returns)
    vol = std * math.sqrt(TRADING_DAYS)
    sharpe = (mean(returns) / std * math.sqrt(TRADING_DAYS)) if std else None

    # Beta vs the equal-weighted market, aligned on shared dates.
    stock_aligned, market_aligned = [], []
    for d, r in zip(dates[1:], returns):  # returns line up with dates[1:]
        if d in market_returns_by_date:
            stock_aligned.append(r)
            market_aligned.append(market_returns_by_date[d])
    mkt_var = variance(market_aligned)
    beta = (covariance(stock_aligned, market_aligned) / mkt_var) if mkt_var else None

    return {
        'symbol': symbol,
        'mean_return': mean(returns),
        'volatility': vol,
        'sharpe_ratio': sharpe,
        'max_drawdown': max_drawdown(returns),
        'var_95': percentile(returns, 5),
        'beta': beta,
        'observations': len(returns),
    }


def build_database(price_data):
    """price_data: {symbol: [row dicts sorted by date]}."""
    os.makedirs('data/processed', exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    create_schema(cur)

    # Reset content so re-runs are idempotent.
    for t in ('prices', 'stock_risk_metrics', 'portfolio_risk_metrics',
              'portfolio_holdings'):
        cur.execute(f'DELETE FROM {t}')

    cur.executemany('INSERT OR IGNORE INTO stocks VALUES (?,?,?,?)', STOCK_INFO)

    for symbol, rows in price_data.items():
        cur.executemany(
            'INSERT INTO prices (symbol,date,open,high,low,close,volume,'
            'adjusted_close) VALUES (?,?,?,?,?,?,?,?)',
            [(symbol, r['date'], r['open'], r['high'], r['low'], r['close'],
              r['volume'], r['adjusted_close']) for r in rows])

    # Per-symbol return series, plus the equal-weighted market return per date.
    returns_by_symbol, dates_by_symbol = {}, {}
    market_sum, market_count = {}, {}
    for symbol, rows in price_data.items():
        dates = [r['date'] for r in rows]
        rets = daily_returns([r['adjusted_close'] for r in rows])
        returns_by_symbol[symbol] = rets
        dates_by_symbol[symbol] = dates
        for d, r in zip(dates[1:], rets):
            market_sum[d] = market_sum.get(d, 0.0) + r
            market_count[d] = market_count.get(d, 0) + 1
    market_returns_by_date = {d: market_sum[d] / market_count[d]
                              for d in market_sum}

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for symbol in price_data:
        m = compute_stock_metrics(symbol, returns_by_symbol[symbol],
                                  market_returns_by_date, dates_by_symbol[symbol])
        cur.execute(
            'INSERT INTO stock_risk_metrics (symbol,mean_return,volatility,'
            'sharpe_ratio,max_drawdown,var_95,beta,observations,calculated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?)',
            (m['symbol'], m['mean_return'], m['volatility'], m['sharpe_ratio'],
             m['max_drawdown'], m['var_95'], m['beta'], m['observations'], now))

    # Sample portfolio + holdings.
    cur.execute("INSERT OR IGNORE INTO portfolios (id,name,description) "
                "VALUES (1,'Sample Tech Portfolio','Equal-weighted tech stocks')")
    cur.executemany(
        'INSERT INTO portfolio_holdings (portfolio_id,symbol,quantity,'
        'purchase_date,purchase_price) VALUES (?,?,?,?,?)', SAMPLE_HOLDINGS)

    # Portfolio metrics: value-weighted by latest price, aligned on dates.
    latest_price = {s: rows[-1]['adjusted_close']
                    for s, rows in price_data.items() if rows}
    weights, total = {}, 0.0
    for _, sym, qty, _, _ in SAMPLE_HOLDINGS:
        val = qty * latest_price.get(sym, 0.0)
        weights[sym] = weights.get(sym, 0.0) + val
        total += val
    if total:
        weights = {s: v / total for s, v in weights.items()}
        ret_lookup = {s: dict(zip(dates_by_symbol[s][1:], returns_by_symbol[s]))
                      for s in weights}
        all_dates = sorted({d for s in weights for d in ret_lookup[s]})
        port_returns = []
        for d in all_dates:
            day = sum(w * ret_lookup[s].get(d, 0.0) for s, w in weights.items())
            port_returns.append(day)
        std = pstdev(port_returns)
        cur.execute(
            'INSERT INTO portfolio_risk_metrics (portfolio_id,mean_return,'
            'volatility,sharpe_ratio,max_drawdown,calculated_at) '
            'VALUES (?,?,?,?,?,?)',
            (1, mean(port_returns), std * math.sqrt(TRADING_DAYS),
             (mean(port_returns) / std * math.sqrt(TRADING_DAYS)) if std else None,
             max_drawdown(port_returns), now))

    conn.commit()
    conn.close()


def main():
    end = datetime.today()
    start = end - timedelta(days=365 * YEARS_OF_HISTORY)
    print(f"Fetching real prices from Stooq ({start:%Y-%m-%d} to {end:%Y-%m-%d})...")

    price_data, failures = {}, []
    for i, ticker in enumerate(TICKERS):
        if i:
            time.sleep(REQUEST_DELAY_SECONDS)
        try:
            rows = fetch_prices(ticker, start, end)
            if not rows:
                raise ValueError('no rows returned')
            price_data[ticker] = rows
            print(f"  {ticker}: {len(rows)} trading days "
                  f"({rows[0]['date']} to {rows[-1]['date']})")
        except (urllib.error.URLError, ValueError, TimeoutError) as e:
            failures.append((ticker, str(e)))
            print(f"  {ticker}: FAILED ({e})")

    if not price_data:
        print("\nERROR: Could not fetch any data. The network may be blocked by "
              "an egress policy, or Stooq may be unreachable.\n"
              "Existing database left untouched. To use mock data instead:\n"
              "  python python/generate_sample_data.py")
        sys.exit(1)

    if failures:
        print(f"\nWARNING: {len(failures)} ticker(s) failed; building DB with the "
              f"{len(price_data)} that succeeded.")

    build_database(price_data)
    print(f"\nDatabase built at {DB_PATH} with real market data.")
    print(f"  Stocks with data: {len(price_data)}")
    print(f"  Total price rows: {sum(len(v) for v in price_data.values())}")
    print("  Risk metrics computed from the fetched prices.")


if __name__ == '__main__':
    main()
