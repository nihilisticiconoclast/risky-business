#' Calculate Risk Metrics from Financial Data
#'
#' This script connects to the SQLite database, loads price data,
#' calculates various risk metrics, and saves them back to the database.

library(DBI)
library(RSQLite)
library(dplyr)
library(PerformanceAnalytics)
library(TTR)

# Function to calculate max drawdown
max_drawdown <- function(returns) {
  cumulative <- cumprod(1 + returns)
  running_max <- cummax(cumulative)
  drawdowns <- (cumulative - running_max) / running_max
  return(min(drawdowns, na.rm = TRUE))
}

# Main function to calculate all metrics
calculate_metrics <- function(db_path = "../data/processed/finance_data.db") {
  
  cat("Connecting to database...\n")
  
  # Connect to SQLite database
  con <- dbConnect(RSQLite::SQLite(), db_path)
  
  # Load price data
  cat("Loading price data...\n")
  prices <- dbGetQuery(con, "
    SELECT symbol, date, adjusted_close as price
    FROM prices
    ORDER BY symbol, date
  ")
  
  if (nrow(prices) == 0) {
    stop("No price data found in database. Run Python scripts first.")
  }
  
  cat(sprintf("Loaded %d price records for %d symbols\n", 
              nrow(prices), length(unique(prices$symbol))))
  
  # Calculate daily returns
  cat("Calculating daily returns...\n")
  returns <- prices %>%
    group_by(symbol) %>%
    arrange(date) %>%
    mutate(return = price / lag(price) - 1) %>%
    na.omit()
  
  # Calculate risk metrics per stock
  cat("Calculating stock risk metrics...\n")
  risk_metrics <- returns %>%
    group_by(symbol) %>%
    summarise(
      mean_return = mean(return, na.rm = TRUE),
      volatility = sd(return, na.rm = TRUE) * sqrt(252),  # Annualized
      sharpe_ratio = ifelse(sd(return, na.rm = TRUE) == 0, NA, 
                           mean(return, na.rm = TRUE) / sd(return, na.rm = TRUE) * sqrt(252)),
      max_drawdown = max_drawdown(return),
      var_95 = VaR(return, p = 0.95, method = "historical"),
      observations = n()
    )
  
  # Calculate beta for each stock (using equal-weighted portfolio as benchmark)
  cat("Calculating beta values...\n")
  
  # Get all symbols
  all_symbols <- unique(returns$symbol)
  
  # Calculate market returns (equal-weighted)
  market_returns <- returns %>%
    group_by(date) %>%
    summarise(market_return = mean(return, na.rm = TRUE)) %>%
    ungroup()
  
  # Merge market returns with individual stock returns
  returns_with_market <- returns %>%
    left_join(market_returns, by = "date")
  
  # Calculate beta for each stock
  beta_values <- returns_with_market %>%
    group_by(symbol) %>%
    summarise(
      beta = cov(return, market_return, na.rm = TRUE) / var(market_return, na.rm = TRUE)
    )
  
  # Merge beta with risk metrics
  risk_metrics <- risk_metrics %>%
    left_join(beta_values, by = "symbol")
  
  # Add calculated timestamp
  risk_metrics$calculated_at <- Sys.time()
  
  # Save to database
  cat("Saving stock risk metrics to database...\n")
  dbWriteTable(con, "stock_risk_metrics", risk_metrics, overwrite = TRUE)
  
  # Calculate portfolio-level metrics for sample portfolio (ID = 1)
  cat("Calculating portfolio risk metrics...\n")
  
  # Get portfolio holdings
  holdings <- dbGetQuery(con, "
    SELECT symbol, quantity, purchase_price
    FROM portfolio_holdings
    WHERE portfolio_id = 1
  ")
  
  if (nrow(holdings) == 0) {
    warning("No portfolio holdings found for portfolio ID 1")
  } else {
    # Calculate weights based on current prices
    latest_prices <- prices %>%
      group_by(symbol) %>%
      slice(n()) %>%
      ungroup() %>%
      select(symbol, price)
    
    holdings_with_prices <- holdings %>%
      left_join(latest_prices, by = "symbol") %>%
      mutate(
        current_value = quantity * price,
        total_value = sum(current_value, na.rm = TRUE)
      ) %>%
      mutate(weight = current_value / total_value)
    
    # Calculate portfolio returns
    portfolio_returns <- returns %>%
      filter(symbol %in% holdings$symbol) %>%
      left_join(holdings_with_prices %>% select(symbol, weight), by = "symbol") %>%
      group_by(date) %>%
      summarise(portfolio_return = sum(return * weight, na.rm = TRUE)) %>%
      na.omit()
    
    # Calculate portfolio risk metrics
    portfolio_risk <- data.frame(
      portfolio_id = 1,
      mean_return = mean(portfolio_returns$portfolio_return, na.rm = TRUE),
      volatility = sd(portfolio_returns$portfolio_return, na.rm = TRUE) * sqrt(252),
      sharpe_ratio = ifelse(sd(portfolio_returns$portfolio_return, na.rm = TRUE) == 0, NA,
                           mean(portfolio_returns$portfolio_return, na.rm = TRUE) / 
                           sd(portfolio_returns$portfolio_return, na.rm = TRUE) * sqrt(252)),
      max_drawdown = max_drawdown(portfolio_returns$portfolio_return),
      calculated_at = Sys.time()
    )
    
    # Save portfolio metrics
    cat("Saving portfolio risk metrics to database...\n")
    dbWriteTable(con, "portfolio_risk_metrics", portfolio_risk, overwrite = TRUE)
    
    # Print portfolio summary
    cat("\nPortfolio Risk Metrics Summary:\n")
    cat(sprintf("  Annualized Return: %.2f%%\n", 
                portfolio_risk$mean_return * 100 * 252))
    cat(sprintf("  Annualized Volatility: %.2f%%\n", 
                portfolio_risk$volatility * 100))
    cat(sprintf("  Sharpe Ratio: %.2f\n", portfolio_risk$sharpe_ratio))
    cat(sprintf("  Max Drawdown: %.2f%%\n", portfolio_risk$max_drawdown * 100))
  }
  
  # Disconnect from database
  dbDisconnect(con)
  
  # Return data for visualization
  list(
    stock_metrics = risk_metrics,
    portfolio_returns = portfolio_returns,
    portfolio_metrics = portfolio_risk
  )
}

# Run the function if this script is executed directly
if (interactive() || !exists("db_path")) {
  result <- calculate_metrics()
  cat("\nMetrics calculation complete!\n")
}
