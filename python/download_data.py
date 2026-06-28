import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import os

# Configuration
TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'V', 'PG', 'DIS']
END_DATE = datetime.today().strftime('%Y-%m-%d')
START_DATE = (datetime.today() - timedelta(days=365*3)).strftime('%Y-%m-%d')  # 3 years

def download_stock_data():
    """Download historical price data for all tickers."""
    print(f"Downloading stock data from {START_DATE} to {END_DATE}...")
    
    # Create raw data directory if it doesn't exist
    os.makedirs('data/raw', exist_ok=True)
    
    all_data = {}
    for ticker in TICKERS:
        print(f"  Downloading {ticker}...")
        try:
            stock = yf.Ticker(ticker)
            df = stock.history(start=START_DATE, end=END_DATE)
            df['symbol'] = ticker
            all_data[ticker] = df
            
            # Save individual files
            df.to_csv(f'data/raw/{ticker}_prices.csv')
            print(f"    Saved {ticker}_prices.csv")
        except Exception as e:
            print(f"    Error downloading {ticker}: {e}")
    
    # Save combined
    if all_data:
        combined = pd.concat(all_data.values())
        combined.to_csv('data/raw/all_prices.csv', index=True)
        print(f"  Saved combined all_prices.csv")
    
    print(f"\nDownloaded data for {len(all_data)}/{len(TICKERS)} tickers successfully.")
    return combined if all_data else pd.DataFrame()

if __name__ == '__main__':
    download_stock_data()
