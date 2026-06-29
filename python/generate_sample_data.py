#!/usr/bin/env python3
"""
Generate sample financial data for testing the Risk Metrics Dashboard.
This creates a SQLite database with mock data when yfinance is not available.
"""

import sqlite3
import os
from datetime import datetime, timedelta
import random

# Configuration
TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'V', 'PG', 'DIS']
START_DATE = (datetime.today() - timedelta(days=365*3)).strftime('%Y-%m-%d')
END_DATE = datetime.today().strftime('%Y-%m-%d')

def generate_date_range(start_date, end_date):
    """Generate list of dates between start and end."""
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')
    date_list = []
    current = start
    while current <= end:
        date_list.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    return date_list

def generate_stock_prices(symbol, dates):
    """Generate mock stock price data with realistic patterns."""
    # Base price for each stock
    base_prices = {
        'AAPL': 150, 'MSFT': 250, 'GOOGL': 100, 'AMZN': 100, 'META': 180,
        'TSLA': 200, 'JPM': 120, 'V': 200, 'PG': 140, 'DIS': 100
    }
    
    base = base_prices.get(symbol, 100)
    prices = []
    current_price = base
    
    for date in dates:
        # Add some trend based on symbol
        trend_factor = 1.0
        if symbol in ['AAPL', 'MSFT', 'GOOGL', 'AMZN']:
            trend_factor = 1.0005  # Tech stocks slightly up
        elif symbol in ['TSLA', 'META']:
            trend_factor = 0.9995  # More volatile
        
        # Daily change with volatility
        volatility = 0.02 if symbol in ['TSLA', 'META'] else 0.015
        daily_change = random.uniform(-volatility, volatility)
        
        current_price = current_price * (1 + daily_change) * trend_factor
        
        # Add some periodic patterns (weekly, monthly)
        day_of_week = datetime.strptime(date, '%Y-%m-%d').weekday()
        if day_of_week == 0:  # Monday
            current_price *= 1.002
        elif day_of_week == 4:  # Friday
            current_price *= 0.998
        
        prices.append({
            'date': date,
            'open': current_price * random.uniform(0.995, 1.005),
            'high': current_price * random.uniform(1.002, 1.015),
            'low': current_price * random.uniform(0.985, 0.995),
            'close': current_price,
            'volume': random.randint(1000000, 50000000),
            'adjusted_close': current_price
        })
    
    return prices

def generate_sample_database():
    """Generate a sample SQLite database with mock financial data."""
    print("Generating sample financial database...")

    # Seed the RNG so the generated database is reproducible across runs.
    random.seed(42)
    
    # Create directories if they don't exist
    os.makedirs('data/processed', exist_ok=True)
    os.makedirs('data/raw', exist_ok=True)
    
    # Generate dates
    dates = generate_date_range(START_DATE, END_DATE)
    print(f"  Generated {len(dates)} dates from {START_DATE} to {END_DATE}")
    
    # Connect to database
    DB_PATH = 'data/processed/finance_data.db'
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Enable foreign key support
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Create tables
    print("  Creating tables...")
    
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
        dividends REAL DEFAULT 0,
        stock_splits REAL DEFAULT 1,
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
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS stock_risk_metrics (
        symbol TEXT PRIMARY KEY,
        mean_return REAL,
        volatility REAL,
        sharpe_ratio REAL,
        max_drawdown REAL,
        var_95 REAL,
        beta REAL,
        observations INTEGER,
        calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol)
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS portfolio_risk_metrics (
        portfolio_id INTEGER,
        mean_return REAL,
        volatility REAL,
        sharpe_ratio REAL,
        max_drawdown REAL,
        calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
    )
    ''')
    
    # Insert stock information
    print("  Inserting stock information...")
    stock_info = [
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
    
    for symbol, name, sector, industry in stock_info:
        cursor.execute('''
        INSERT OR IGNORE INTO stocks (symbol, name, sector, industry)
        VALUES (?, ?, ?, ?)
        ''', (symbol, name, sector, industry))
    
    # Generate and insert price data
    print("  Generating and inserting price data...")
    for symbol in TICKERS:
        prices = generate_stock_prices(symbol, dates)
        for price in prices:
            cursor.execute('''
            INSERT INTO prices (symbol, date, open, high, low, close, volume, adjusted_close)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (symbol, price['date'], price['open'], price['high'], price['low'],
                  price['close'], price['volume'], price['adjusted_close']))
        print(f"    Inserted {len(prices)} records for {symbol}")
    
    # Insert sample portfolio
    print("  Creating sample portfolio...")
    cursor.execute('''
    INSERT OR IGNORE INTO portfolios (id, name, description)
    VALUES (1, 'Sample Tech Portfolio', 'Equal-weighted tech stocks')
    ''')
    
    sample_holdings = [
        (1, 'AAPL', 100, '2023-01-01', 150.0),
        (1, 'MSFT', 100, '2023-01-01', 250.0),
        (1, 'GOOGL', 50, '2023-01-01', 100.0),
        (1, 'AMZN', 20, '2023-01-01', 100.0),
    ]
    
    cursor.execute("DELETE FROM portfolio_holdings WHERE portfolio_id = 1")
    for portfolio_id, symbol, qty, date, price in sample_holdings:
        cursor.execute('''
        INSERT INTO portfolio_holdings (portfolio_id, symbol, quantity, purchase_date, purchase_price)
        VALUES (?, ?, ?, ?, ?)
        ''', (portfolio_id, symbol, qty, date, price))
    
    # Generate and insert sample risk metrics
    print("  Generating sample risk metrics...")
    
    # Stock risk metrics (mock values based on typical ranges)
    stock_metrics = {
        'AAPL': {'mean_return': 0.001, 'volatility': 0.25, 'sharpe_ratio': 1.2, 
                 'max_drawdown': -0.15, 'var_95': -0.03, 'beta': 1.1, 'observations': 750},
        'MSFT': {'mean_return': 0.0012, 'volatility': 0.22, 'sharpe_ratio': 1.4, 
                 'max_drawdown': -0.12, 'var_95': -0.025, 'beta': 0.9, 'observations': 750},
        'GOOGL': {'mean_return': 0.0011, 'volatility': 0.24, 'sharpe_ratio': 1.3, 
                  'max_drawdown': -0.14, 'var_95': -0.028, 'beta': 1.05, 'observations': 750},
        'AMZN': {'mean_return': 0.0015, 'volatility': 0.28, 'sharpe_ratio': 1.1, 
                 'max_drawdown': -0.18, 'var_95': -0.035, 'beta': 1.2, 'observations': 750},
        'META': {'mean_return': 0.0008, 'volatility': 0.30, 'sharpe_ratio': 0.9, 
                 'max_drawdown': -0.20, 'var_95': -0.04, 'beta': 1.3, 'observations': 750},
        'TSLA': {'mean_return': 0.002, 'volatility': 0.35, 'sharpe_ratio': 0.8, 
                 'max_drawdown': -0.25, 'var_95': -0.05, 'beta': 1.5, 'observations': 750},
        'JPM': {'mean_return': 0.0007, 'volatility': 0.20, 'sharpe_ratio': 1.0, 
                'max_drawdown': -0.10, 'var_95': -0.02, 'beta': 0.8, 'observations': 750},
        'V': {'mean_return': 0.0009, 'volatility': 0.18, 'sharpe_ratio': 1.5, 
              'max_drawdown': -0.08, 'var_95': -0.018, 'beta': 0.7, 'observations': 750},
        'PG': {'mean_return': 0.0005, 'volatility': 0.15, 'sharpe_ratio': 1.2, 
               'max_drawdown': -0.07, 'var_95': -0.015, 'beta': 0.6, 'observations': 750},
        'DIS': {'mean_return': 0.0006, 'volatility': 0.22, 'sharpe_ratio': 1.0, 
                'max_drawdown': -0.12, 'var_95': -0.022, 'beta': 0.95, 'observations': 750},
    }
    
    cursor.execute("DELETE FROM stock_risk_metrics")
    for symbol, metrics in stock_metrics.items():
        cursor.execute('''
        INSERT INTO stock_risk_metrics (symbol, mean_return, volatility, sharpe_ratio, 
                                         max_drawdown, var_95, beta, observations, calculated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (symbol, metrics['mean_return'], metrics['volatility'], metrics['sharpe_ratio'],
              metrics['max_drawdown'], metrics['var_95'], metrics['beta'],
              metrics['observations'], datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    
    # Portfolio risk metrics (calculated from sample holdings)
    # AAPL: 100 shares at $150 = $15,000
    # MSFT: 100 shares at $250 = $25,000
    # GOOGL: 50 shares at $100 = $5,000
    # AMZN: 20 shares at $100 = $2,000
    # Total = $47,000
    # Weights: AAPL=31.9%, MSFT=53.2%, GOOGL=10.6%, AMZN=4.3%
    
    portfolio_mean_return = 0.00115  # Weighted average
    portfolio_volatility = 0.235     # Portfolio volatility
    portfolio_sharpe = 1.25          # Portfolio Sharpe ratio
    portfolio_max_drawdown = -0.13  # Portfolio max drawdown
    
    cursor.execute("DELETE FROM portfolio_risk_metrics WHERE portfolio_id = 1")
    cursor.execute('''
    INSERT INTO portfolio_risk_metrics (portfolio_id, mean_return, volatility, 
                                         sharpe_ratio, max_drawdown, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ''', (1, portfolio_mean_return, portfolio_volatility, portfolio_sharpe,
          portfolio_max_drawdown, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    
    # Commit changes
    conn.commit()
    conn.close()
    
    print(f"\nSample database created successfully at {DB_PATH}")
    print(f"  Database size: {os.path.getsize(DB_PATH) / 1024 / 1024:.2f} MB")
    print(f"  Date range: {START_DATE} to {END_DATE}")
    print(f"  Stocks: {len(TICKERS)}")
    print(f"  Price records: {len(TICKERS) * len(dates)}")
    
    return DB_PATH

if __name__ == '__main__':
    generate_sample_database()
