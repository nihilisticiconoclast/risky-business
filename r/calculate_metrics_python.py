#!/usr/bin/env python3
"""
Calculate risk metrics from financial data in SQLite database.
This is a Python alternative to the R script.
"""

import sqlite3
import numpy as np
import pandas as pd
from datetime import datetime
import os

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))

# Database path - use the symlink or the actual file
db_path = os.path.join(script_dir, '../data/processed/finance_data.db')

# Ensure the path exists (follow symlinks)
if not os.path.exists(db_path):
    # Try the actual sqlite file
    db_path_sqlite = os.path.join(script_dir, '../data/processed/finance_data.sqlite')
    if os.path.exists(db_path_sqlite):
        db_path = db_path_sqlite
    else:
        print(f"ERROR: Database not found at {db_path} or {db_path_sqlite}")
        exit(1)

print(f"Connecting to database: {db_path}")
conn = sqlite3.connect(db_path)

# Load price data
print("Loading price data...")
prices_df = pd.read_sql("""
    SELECT symbol, date, adjusted_close as price
    FROM prices
    ORDER BY symbol, date
""", conn)

if len(prices_df) == 0:
    print("ERROR: No price data found in database")
    conn.close()
    exit(1)

# Convert date to datetime
prices_df['date'] = pd.to_datetime(prices_df['date'])

print(f"Loaded {len(prices_df)} price records for {prices_df['symbol'].nunique()} symbols")

# Calculate daily returns
print("Calculating daily returns...")
prices_df['return'] = prices_df.groupby('symbol')['price'].pct_change()
returns_df = prices_df.dropna(subset=['return'])

# Function to calculate max drawdown
def max_drawdown(returns):
    """Calculate max drawdown from a series of returns."""
    if len(returns) == 0:
        return None
    # Convert to pandas Series if it's a numpy array
    if isinstance(returns, np.ndarray):
        returns = pd.Series(returns)
    cumulative = (1 + returns).cumprod()
    running_max = cumulative.cummax()
    drawdowns = (cumulative - running_max) / running_max
    return float(drawdowns.min())

# Function to calculate VaR (historical method)
def historical_var(returns, p=0.95):
    if len(returns) == 0:
        return None
    return float(np.percentile(returns, 100 * (1 - p)))

# Calculate risk metrics per stock
print("Calculating stock risk metrics...")
risk_metrics = []
for symbol, group in returns_df.groupby('symbol'):
    returns = group['return'].values
    
    mean_return = float(np.mean(returns))
    volatility = float(np.std(returns) * np.sqrt(252))  # Annualized
    
    if np.std(returns) == 0:
        sharpe_ratio = None
    else:
        sharpe_ratio = float(mean_return / np.std(returns) * np.sqrt(252))
    
    md = max_drawdown(returns)
    var_95 = historical_var(returns, p=0.95)
    
    risk_metrics.append({
        'symbol': symbol,
        'mean_return': mean_return,
        'volatility': volatility,
        'sharpe_ratio': sharpe_ratio,
        'max_drawdown': md,
        'var_95': var_95,
        'observations': len(returns),
        'calculated_at': datetime.now().isoformat()
    })

stock_metrics_df = pd.DataFrame(risk_metrics)

# Calculate beta for each stock
print("Calculating beta values...")

# Calculate market returns (equal-weighted)
market_returns = returns_df.groupby('date')['return'].mean().reset_index()
market_returns.columns = ['date', 'market_return']

# Merge market returns with individual stock returns
returns_with_market = pd.merge(returns_df, market_returns, on='date', how='left')

# Calculate beta for each stock
beta_values = []
for symbol, group in returns_with_market.groupby('symbol'):
    stock_returns = group['return'].values
    market_returns_vals = group['market_return'].values
    
    # Remove NaN values
    valid_idx = ~(np.isnan(stock_returns) | np.isnan(market_returns_vals))
    stock_returns = stock_returns[valid_idx]
    market_returns_vals = market_returns_vals[valid_idx]
    
    if len(stock_returns) > 1 and len(market_returns_vals) > 1:
        cov_matrix = np.cov(stock_returns, market_returns_vals)
        beta = float(cov_matrix[0, 1] / cov_matrix[1, 1])
    else:
        beta = None
    
    beta_values.append({'symbol': symbol, 'beta': beta})

beta_df = pd.DataFrame(beta_values)

# Merge beta with risk metrics
stock_metrics_df = pd.merge(stock_metrics_df, beta_df, on='symbol', how='left')

# Save stock risk metrics to database
print("Saving stock risk metrics to database...")
stock_metrics_df.to_sql('stock_risk_metrics', conn, if_exists='replace', index=False)

# Calculate portfolio-level metrics for portfolio ID = 1
print("Calculating portfolio risk metrics...")

holdings_df = pd.read_sql("""
    SELECT symbol, quantity, purchase_price
    FROM portfolio_holdings
    WHERE portfolio_id = 1
""", conn)

if len(holdings_df) == 0:
    print("WARNING: No portfolio holdings found for portfolio ID 1")
else:
    # Get latest prices for each symbol
    latest_prices = prices_df.loc[prices_df.groupby('symbol')['date'].idxmax()][['symbol', 'price']]
    
    # Calculate weights
    holdings_with_prices = pd.merge(holdings_df, latest_prices, on='symbol', how='left')
    holdings_with_prices['current_value'] = holdings_with_prices['quantity'] * holdings_with_prices['price']
    total_value = holdings_with_prices['current_value'].sum()
    holdings_with_prices['weight'] = holdings_with_prices['current_value'] / total_value
    
    print(f"  Portfolio holdings: {len(holdings_with_prices)}")
    print(f"  Total value: {total_value:.2f}")
    
    # Calculate portfolio returns
    portfolio_returns_list = []
    for date, date_group in returns_df.groupby('date'):
        date_holdings = holdings_with_prices[holdings_with_prices['symbol'].isin(date_group['symbol'])]
        if len(date_holdings) > 0:
            # Weighted sum of returns
            weighted_returns = 0.0
            for _, row in date_holdings.iterrows():
                stock_return = date_group[date_group['symbol'] == row['symbol']]['return'].values
                if len(stock_return) > 0:
                    weighted_returns += stock_return[0] * row['weight']
            portfolio_returns_list.append({'date': date, 'portfolio_return': weighted_returns})
    
    portfolio_returns_df = pd.DataFrame(portfolio_returns_list).dropna()
    
    if len(portfolio_returns_df) > 0:
        # Calculate portfolio risk metrics
        port_returns = portfolio_returns_df['portfolio_return'].values
        
        mean_ret = float(np.mean(port_returns))
        vol = float(np.std(port_returns) * np.sqrt(252))
        
        if np.std(port_returns) != 0:
            sharpe = float(mean_ret / np.std(port_returns) * np.sqrt(252))
        else:
            sharpe = None
        
        md = max_drawdown(port_returns)
        
        portfolio_risk = {
            'portfolio_id': 1,
            'mean_return': mean_ret,
            'volatility': vol,
            'sharpe_ratio': sharpe,
            'max_drawdown': md,
            'calculated_at': datetime.now().isoformat()
        }
        
        # Save portfolio metrics
        print("Saving portfolio risk metrics to database...")
        portfolio_risk_df = pd.DataFrame([portfolio_risk])
        portfolio_risk_df.to_sql('portfolio_risk_metrics', conn, if_exists='replace', index=False)
        
        # Print portfolio summary
        print("\nPortfolio Risk Metrics Summary:")
        print(f"  Annualized Return: {portfolio_risk['mean_return'] * 100 * 252:.2f}%")
        print(f"  Annualized Volatility: {portfolio_risk['volatility'] * 100:.2f}%")
        if portfolio_risk['sharpe_ratio'] is not None:
            print(f"  Sharpe Ratio: {portfolio_risk['sharpe_ratio']:.2f}")
        else:
            print("  Sharpe Ratio: N/A")
        print(f"  Max Drawdown: {portfolio_risk['max_drawdown'] * 100:.2f}%")
    else:
        print("WARNING: No valid portfolio returns calculated")

# Close connection
conn.close()

print("\nMetrics calculation complete!")
