import pandas as pd
import numpy as np
import os

def clean_stock_data():
    """Clean and preprocess the downloaded stock data."""
    print("Cleaning stock data...")
    
    # Create processed directory if it doesn't exist
    os.makedirs('data/processed', exist_ok=True)
    
    # Load combined data
    try:
        df = pd.read_csv('data/raw/all_prices.csv')
        print(f"  Loaded {len(df)} rows of data")
    except FileNotFoundError:
        print("  Error: all_prices.csv not found. Run download_data.py first.")
        return None
    
    # Check for missing values
    print(f"  Missing values before cleaning: {df.isnull().sum().sum()}")
    
    # Drop rows with all NA values
    df = df.dropna(how='all')
    
    # Forward fill missing values (common for stock data)
    df = df.groupby('symbol').apply(lambda x: x.ffill().bfill())
    
    # Remove duplicate rows
    df = df.drop_duplicates()
    
    # Ensure we have required columns
    required_columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume', 'Dividends', 'Stock Splits', 'symbol']
    
    for col in required_columns:
        if col not in df.columns:
            print(f"  Warning: Missing column {col}")
    
    # Calculate adjusted close if not present
    if 'Adj Close' not in df.columns:
        print("  Calculating Adjusted Close from Close")
        df['Adj Close'] = df['Close']
    
    # Rename columns to lowercase for consistency
    df = df.rename(columns={
        'Date': 'date',
        'Open': 'open',
        'High': 'high', 
        'Low': 'low',
        'Close': 'close',
        'Volume': 'volume',
        'Dividends': 'dividends',
        'Stock Splits': 'stock_splits',
        'Adj Close': 'adjusted_close'
    })
    
    # Convert date to string format (handle timezone by converting to UTC first)
    df['date'] = pd.to_datetime(df['date'], utc=True).dt.tz_localize(None).dt.strftime('%Y-%m-%d')
    
    # Sort by symbol and date
    df = df.sort_values(['symbol', 'date'])
    
    # Save cleaned data
    df.to_csv('data/processed/cleaned_prices.csv', index=False)
    print(f"  Saved cleaned data to data/processed/cleaned_prices.csv")
    print(f"  Final shape: {df.shape}")
    print(f"  Missing values after cleaning: {df.isnull().sum().sum()}")
    
    return df

if __name__ == '__main__':
    clean_stock_data()
