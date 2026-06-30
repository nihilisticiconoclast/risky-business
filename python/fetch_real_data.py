#!/usr/bin/env python3
"""
Fetch *real* historical price data and build the dashboard's SQLite database.

This is a drop-in, dependency-free alternative to the
download_data.py -> clean_data.py -> build_database.py -> calculate_metrics.R
pipeline. It uses only the Python standard library (urllib, csv, sqlite3,
math) so it needs neither pandas, yfinance, nor R.

Data sources (all free):
  * Tiingo (https://tiingo.com) -- keyed, used first when TIINGO_API_KEY is
    set. Recommended for automation: the key authenticates you, so it works
    from CI runners.
  * Stooq (https://stooq.com) and the Yahoo Finance v8 chart API -- keyless
    fallbacks. Convenient for local runs, but both block/throttle datacenter
    IPs (GitHub Actions runners get an HTML block page / HTTP 429), so they are
    not reliable for the scheduled refresh.

Usage:
    python python/fetch_real_data.py

If every provider is unreachable (e.g. a sandboxed/offline environment), the
script exits with a clear message and leaves any existing database untouched,
so you can fall back to `python python/generate_sample_data.py`.

Swapping/adding providers: each provider is a small `_fetch_*` function
returning the same list of row dicts; add one to the `PROVIDERS` list (e.g.
Alpha Vantage, Tiingo, Twelve Data). The rest of the pipeline is
provider-agnostic.
"""

import calendar
import csv
import io
import json
import math
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# Configuration ---------------------------------------------------------------
YEARS_OF_HISTORY = 10  # both providers serve decades of free daily history
TRADING_DAYS = 252  # for annualization
REQUEST_DELAY_SECONDS = 1.0  # be polite between requests
USER_AGENT = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/120.0 Safari/537.36')
# Tiingo is a free, keyed provider. It authenticates by token, so unlike the
# keyless sources it is not blocked from datacenter IPs (CI runners). Set the
# TIINGO_API_KEY env var (or repo secret) to enable it; it then takes priority.
TIINGO_TOKEN = os.environ.get('TIINGO_API_KEY', '').strip()
DB_PATH = 'data/processed/finance_data.db'

# Single source of truth for which stocks the dashboard tracks. To add a stock,
# add one (symbol, name, sector, industry, region) row here -- TICKERS is
# derived from it, so the fetch list and the stocks table can never drift apart.
#
# FTSE 100 names are tracked via their US-listed ADRs (e.g. SHEL, AZN, HSBC) so
# they come through Tiingo's free US end-of-day feed and work from CI. ADR
# prices are in USD, like the rest of the universe.
STOCK_INFO = [
    # === US ===
    ('AAPL', 'Apple Inc.', 'Technology', 'Consumer Electronics', 'US'),
    ('MSFT', 'Microsoft Corporation', 'Technology', 'Software', 'US'),
    ('GOOGL', 'Alphabet Inc.', 'Technology', 'Internet', 'US'),
    ('AMZN', 'Amazon.com Inc.', 'Consumer Discretionary', 'E-commerce', 'US'),
    ('META', 'Meta Platforms Inc.', 'Technology', 'Social Media', 'US'),
    ('TSLA', 'Tesla Inc.', 'Consumer Discretionary', 'Automotive', 'US'),
    ('JPM', 'JPMorgan Chase & Co.', 'Financial Services', 'Banks', 'US'),
    ('V', 'Visa Inc.', 'Financial Services', 'Payment Processing', 'US'),
    ('PG', 'Procter & Gamble Co.', 'Consumer Staples', 'Household Products', 'US'),
    ('DIS', 'The Walt Disney Company', 'Communication Services', 'Entertainment', 'US'),
    ('NVDA', 'NVIDIA Corporation', 'Technology', 'Semiconductors', 'US'),
    ('AMD', 'Advanced Micro Devices Inc.', 'Technology', 'Semiconductors', 'US'),
    ('AVGO', 'Broadcom Inc.', 'Technology', 'Semiconductors', 'US'),
    ('INTC', 'Intel Corporation', 'Technology', 'Semiconductors', 'US'),
    ('ORCL', 'Oracle Corporation', 'Technology', 'Software', 'US'),
    ('CRM', 'Salesforce Inc.', 'Technology', 'Software', 'US'),
    ('NFLX', 'Netflix Inc.', 'Communication Services', 'Streaming', 'US'),
    ('JNJ', 'Johnson & Johnson', 'Health Care', 'Pharmaceuticals', 'US'),
    ('UNH', 'UnitedHealth Group Inc.', 'Health Care', 'Managed Care', 'US'),
    ('PFE', 'Pfizer Inc.', 'Health Care', 'Pharmaceuticals', 'US'),
    ('LLY', 'Eli Lilly and Company', 'Health Care', 'Pharmaceuticals', 'US'),
    ('XOM', 'Exxon Mobil Corporation', 'Energy', 'Oil & Gas', 'US'),
    ('CVX', 'Chevron Corporation', 'Energy', 'Oil & Gas', 'US'),
    ('KO', 'The Coca-Cola Company', 'Consumer Staples', 'Beverages', 'US'),
    ('PEP', 'PepsiCo Inc.', 'Consumer Staples', 'Beverages', 'US'),
    ('WMT', 'Walmart Inc.', 'Consumer Staples', 'Retail', 'US'),
    ('HD', 'The Home Depot Inc.', 'Consumer Discretionary', 'Home Improvement Retail', 'US'),
    ('NKE', 'Nike Inc.', 'Consumer Discretionary', 'Apparel', 'US'),
    ('BAC', 'Bank of America Corporation', 'Financial Services', 'Banks', 'US'),
    ('MA', 'Mastercard Incorporated', 'Financial Services', 'Payment Processing', 'US'),
    ('CAT', 'Caterpillar Inc.', 'Industrials', 'Machinery', 'US'),
    ('BA', 'The Boeing Company', 'Industrials', 'Aerospace & Defense', 'US'),
    ('LIN', 'Linde plc', 'Materials', 'Industrial Gases', 'US'),
    ('NEE', 'NextEra Energy Inc.', 'Utilities', 'Electric Utilities', 'US'),
    ('AMT', 'American Tower Corporation', 'Real Estate', 'REITs', 'US'),
    # === UK (FTSE 100, via US-listed ADRs) ===
    ('SHEL', 'Shell plc', 'Energy', 'Oil & Gas', 'UK'),
    ('BP', 'BP p.l.c.', 'Energy', 'Oil & Gas', 'UK'),
    ('AZN', 'AstraZeneca PLC', 'Health Care', 'Pharmaceuticals', 'UK'),
    ('GSK', 'GSK plc', 'Health Care', 'Pharmaceuticals', 'UK'),
    ('HSBC', 'HSBC Holdings plc', 'Financial Services', 'Banks', 'UK'),
    ('BCS', 'Barclays PLC', 'Financial Services', 'Banks', 'UK'),
    ('UL', 'Unilever PLC', 'Consumer Staples', 'Household Products', 'UK'),
    ('DEO', 'Diageo plc', 'Consumer Staples', 'Beverages', 'UK'),
    ('BTI', 'British American Tobacco p.l.c.', 'Consumer Staples', 'Tobacco', 'UK'),
    ('RIO', 'Rio Tinto Group', 'Materials', 'Metals & Mining', 'UK'),
    ('NGG', 'National Grid plc', 'Utilities', 'Electric Utilities', 'UK'),
    ('VOD', 'Vodafone Group Plc', 'Communication Services', 'Telecom', 'UK'),
]

# Derived: the symbols to fetch, in STOCK_INFO order.
TICKERS = [info[0] for info in STOCK_INFO]

SAMPLE_HOLDINGS = [
    (1, 'AAPL', 100, '2023-01-01', 150.0),
    (1, 'MSFT', 100, '2023-01-01', 250.0),
    (1, 'GOOGL', 50, '2023-01-01', 100.0),
    (1, 'AMZN', 20, '2023-01-01', 100.0),
]


# Provider-specific layer -----------------------------------------------------
class ProviderError(Exception):
    """Raised when a data provider returns nothing usable."""


def _http_get(url, headers=None):
    hdrs = {'User-Agent': USER_AGENT}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode('utf-8')


def _fetch_tiingo(ticker, start_date, end_date):
    """Tiingo daily EOD prices (JSON). Free with an API key; CI-friendly."""
    if not TIINGO_TOKEN:
        raise ProviderError('TIINGO_API_KEY not set')
    url = (f'https://api.tiingo.com/tiingo/daily/{ticker}/prices'
           f'?startDate={start_date:%Y-%m-%d}&endDate={end_date:%Y-%m-%d}'
           f'&format=json')
    # Token goes in the header, not the URL, so it stays out of logs.
    text = _http_get(url, headers={'Content-Type': 'application/json',
                                   'Authorization': f'Token {TIINGO_TOKEN}'})
    data = json.loads(text)
    if not isinstance(data, list):
        raise ProviderError(f'unexpected payload {str(data)[:80]!r}')

    rows = []
    for d in data:
        close = d.get('close')
        if close is None:
            continue
        rows.append({
            'date': str(d.get('date', ''))[:10],
            'open': float(d.get('open') if d.get('open') is not None else close),
            'high': float(d.get('high') if d.get('high') is not None else close),
            'low': float(d.get('low') if d.get('low') is not None else close),
            'close': float(close),
            'volume': int(d.get('volume') or 0),
            # adjClose is split- and dividend-adjusted; preferred for returns.
            'adjusted_close': float(d.get('adjClose')
                                    if d.get('adjClose') is not None else close),
        })
    if not rows:
        raise ProviderError('no rows')
    return rows


def _fetch_stooq(ticker, start_date, end_date):
    """Stooq daily CSV. Free, no key. Often rate-limits datacenter IPs."""
    url = (f'https://stooq.com/q/d/l/?s={ticker.lower()}.us'
           f'&d1={start_date:%Y%m%d}&d2={end_date:%Y%m%d}&i=d')
    text = _http_get(url)
    head = text.lstrip().lower()
    if 'exceeded the daily hits limit' in head:
        raise ProviderError('rate limit exceeded')
    if not head.startswith('date'):
        # Stooq returns "No data"/HTML when blocked or symbol unavailable.
        raise ProviderError(f'unexpected response {text[:60]!r}')

    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            close = float(r['Close'])
        except (KeyError, ValueError):
            continue
        rows.append({
            'date': r['Date'],
            'open': float(r.get('Open') or close),
            'high': float(r.get('High') or close),
            'low': float(r.get('Low') or close),
            'close': close,
            'volume': int(float(r.get('Volume') or 0)),
            'adjusted_close': close,  # Stooq daily is split-adjusted
        })
    if not rows:
        raise ProviderError('no rows parsed')
    return rows


def _fetch_yahoo(ticker, start_date, end_date):
    """Yahoo Finance v8 chart API (JSON). Free, no key; reachable from CI IPs."""
    p1 = calendar.timegm(start_date.timetuple())
    p2 = calendar.timegm(end_date.timetuple())
    url = (f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}'
           f'?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit')
    data = json.loads(_http_get(url))
    chart = data.get('chart') or {}
    if chart.get('error'):
        raise ProviderError(f"yahoo error {chart['error']}")
    result = (chart.get('result') or [None])[0]
    if not result:
        raise ProviderError('empty result')

    timestamps = result.get('timestamp') or []
    quote = (result.get('indicators', {}).get('quote') or [{}])[0]
    adj_block = (result.get('indicators', {}).get('adjclose') or [{}])[0]
    adjclose = adj_block.get('adjclose')
    opens, highs = quote.get('open', []), quote.get('high', [])
    lows, closes = quote.get('low', []), quote.get('close', [])
    volumes = quote.get('volume', [])

    rows = []
    for i, ts in enumerate(timestamps):
        close = closes[i] if i < len(closes) else None
        if close is None:
            continue  # holiday / missing bar
        adj = adjclose[i] if (adjclose and i < len(adjclose)
                              and adjclose[i] is not None) else close
        rows.append({
            'date': datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d'),
            'open': float(opens[i]) if i < len(opens) and opens[i] is not None else close,
            'high': float(highs[i]) if i < len(highs) and highs[i] is not None else close,
            'low': float(lows[i]) if i < len(lows) and lows[i] is not None else close,
            'close': float(close),
            'volume': int(volumes[i]) if i < len(volumes) and volumes[i] is not None else 0,
            'adjusted_close': float(adj),
        })
    if not rows:
        raise ProviderError('no usable rows')
    return rows


# Try providers in order; first one that returns data wins. Tiingo goes first
# when a key is configured (works from CI); the keyless sources remain as a
# fallback for local runs from a residential IP.
PROVIDERS = ([('Tiingo', _fetch_tiingo)] if TIINGO_TOKEN else []) + [
    ('Stooq', _fetch_stooq), ('Yahoo', _fetch_yahoo)]


def fetch_prices(ticker, start_date, end_date):
    """Download daily OHLCV rows for one ticker, trying each provider in turn.

    Returns a list of dicts: date, open, high, low, close, volume,
    adjusted_close. Raises ProviderError if every provider fails.
    """
    errors = []
    for name, fn in PROVIDERS:
        try:
            return fn(ticker, start_date, end_date)
        except (ProviderError, urllib.error.URLError, ValueError,
                KeyError, TimeoutError) as e:
            errors.append(f'{name}: {e}')
    raise ProviderError('; '.join(errors))


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
    # Rebuild from scratch each run. The script fully repopulates every table
    # from freshly fetched data, and dropping first means schema changes (e.g.
    # the stocks.region column) apply cleanly to an already-committed database.
    # Drop children before parents to satisfy foreign keys.
    cursor.executescript('''
    DROP TABLE IF EXISTS prices;
    DROP TABLE IF EXISTS portfolio_holdings;
    DROP TABLE IF EXISTS stock_risk_metrics;
    DROP TABLE IF EXISTS portfolio_risk_metrics;
    DROP TABLE IF EXISTS portfolios;
    DROP TABLE IF EXISTS stocks;
    CREATE TABLE stocks (
        symbol TEXT PRIMARY KEY, name TEXT, sector TEXT, industry TEXT,
        region TEXT);
    CREATE TABLE prices (
        symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,
        volume INTEGER, adjusted_close REAL, dividends REAL DEFAULT 0,
        stock_splits REAL DEFAULT 1,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol));
    CREATE TABLE portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE portfolio_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER, symbol TEXT,
        quantity REAL, purchase_date TEXT, purchase_price REAL,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
        FOREIGN KEY (symbol) REFERENCES stocks(symbol));
    CREATE TABLE stock_risk_metrics (
        symbol TEXT PRIMARY KEY, mean_return REAL, volatility REAL,
        sharpe_ratio REAL, max_drawdown REAL, var_95 REAL, beta REAL,
        observations INTEGER, calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol));
    CREATE TABLE portfolio_risk_metrics (
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
    create_schema(cur)  # drops + recreates every table, so it starts empty

    cur.executemany(
        'INSERT INTO stocks (symbol, name, sector, industry, region) '
        'VALUES (?,?,?,?,?)', STOCK_INFO)

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
    providers = ', '.join(name for name, _ in PROVIDERS)
    print(f"Fetching real prices ({start:%Y-%m-%d} to {end:%Y-%m-%d}) "
          f"via: {providers}...")

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
        except (ProviderError, urllib.error.URLError, ValueError,
                TimeoutError) as e:
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
