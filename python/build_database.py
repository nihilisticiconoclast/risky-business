import sqlite3
import pandas as pd
import os
from datetime import datetime

# Create database path
DB_PATH = 'data/processed/finance_data.db'

def build_database():
    """Build SQLite database with financial data and schema."""
    print("Building SQLite database...")
    
    # Create directories if they don't exist
    os.makedirs('data/processed', exist_ok=True)
    
    # Connect to database (creates if doesn't exist)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Enable foreign key support
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Create tables
    print("  Creating tables...")
    
    # Stocks table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS stocks (
        symbol TEXT PRIMARY KEY,
        name TEXT,
        sector TEXT,
        industry TEXT
    )
    ''')
    
    # Prices table
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
        dividends REAL,
        stock_splits REAL,
        FOREIGN KEY (symbol) REFERENCES stocks(symbol)
    )
    ''')
    
    # Portfolios table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Portfolio holdings table
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
    
    # Stock risk metrics table
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
    
    # Portfolio risk metrics table
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
    
    # Load price data from CSV
    print("  Loading price data...")
    try:
        # Try to load cleaned data first
        prices_df = pd.read_csv('data/processed/cleaned_prices.csv', index_col=0)
    except FileNotFoundError:
        try:
            # Fall back to raw data
            prices_df = pd.read_csv('data/raw/all_prices.csv', index_col=0)
        except FileNotFoundError:
            print("  Error: No price data found. Run download_data.py first.")
            conn.close()
            return
    
    # Reset index to make date a column
    prices_df = prices_df.reset_index()
    prices_df = prices_df.rename(columns={'index': 'date'})
    
    # Convert date to string format for SQLite
    prices_df['date'] = pd.to_datetime(prices_df['date']).dt.strftime('%Y-%m-%d')
    
    # Select only the columns we need for the prices table
    columns_to_insert = ['symbol', 'date', 'open', 'high', 'low', 'close', 
                        'volume', 'adjusted_close', 'dividends', 'stock_splits']
    
    # Filter to only include columns that exist
    available_columns = [col for col in columns_to_insert if col in prices_df.columns]
    prices_df = prices_df[available_columns]
    
    # Clear existing prices and insert new data
    cursor.execute("DELETE FROM prices")
    prices_df.to_sql('prices', conn, if_exists='append', index=False)
    
    print(f"  Inserted {len(prices_df)} price records")
    
    # Insert sample portfolio
    print("  Creating sample portfolio...")
    cursor.execute('''
    INSERT OR IGNORE INTO portfolios (id, name, description)
    VALUES (1, 'Sample Tech Portfolio', 'Equal-weighted tech stocks')
    ''')
    
    # Clear existing holdings for portfolio 1
    cursor.execute("DELETE FROM portfolio_holdings WHERE portfolio_id = 1")
    
    sample_holdings = [
        (1, 'AAPL', 100, '2023-01-01', 150.0),
        (1, 'MSFT', 100, '2023-01-01', 250.0),
        (1, 'GOOGL', 50, '2023-01-01', 100.0),
        (1, 'AMZN', 20, '2023-01-01', 100.0),
    ]
    
    for portfolio_id, symbol, qty, date, price in sample_holdings:
        cursor.execute('''
        INSERT INTO portfolio_holdings (portfolio_id, symbol, quantity, purchase_date, purchase_price)
        VALUES (?, ?, ?, ?, ?)
        ''', (portfolio_id, symbol, qty, date, price))
    
    print("  Sample portfolio created with 4 holdings")
    
    # Commit changes
    conn.commit()
    conn.close()
    
    print(f"\nDatabase created successfully at {DB_PATH}")
    print(f"  Database size: {os.path.getsize(DB_PATH) / 1024 / 1024:.2f} MB")
    
    return DB_PATH

if __name__ == '__main__':
    build_database()
