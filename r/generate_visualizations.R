#' Generate Interactive Visualizations for Risk Metrics Dashboard
#'
#' This script loads data from the SQLite database, calculates metrics,
#' and generates interactive HTML visualizations using plotly.

library(plotly)
library(htmlwidgets)
library(DBI)
library(RSQLite)
library(dplyr)

# Function to generate all visualizations
generate_visualizations <- function(db_path = "../data/processed/finance_data.db") {
  
  cat("Connecting to database...\n")
  
  # Connect to SQLite database
  con <- dbConnect(RSQLite::SQLite(), db_path)
  
  # Load metrics from database
  cat("Loading risk metrics...\n")
  stock_metrics <- dbGetQuery(con, "SELECT * FROM stock_risk_metrics")
  portfolio_metrics <- dbGetQuery(con, "SELECT * FROM portfolio_risk_metrics WHERE portfolio_id = 1")
  
  if (nrow(stock_metrics) == 0) {
    stop("No stock metrics found. Run calculate_metrics.R first.")
  }
  
  # Create output directory if it doesn't exist
  if (!dir.exists("output")) {
    dir.create("output")
  }
  
  cat("Generating visualizations...\n")
  
  # 1. Volatility Comparison Bar Chart
  cat("  Creating volatility chart...\n")
  vol_plot <- plot_ly(
    stock_metrics,
    x = ~symbol,
    y = ~volatility,
    type = "bar",
    name = "Annualized Volatility",
    marker = list(color = "#1f77b4"),
    text = ~paste0(sprintf("%.2f%%", volatility * 100), "<br>Observations: ", observations),
    hoverinfo = "text+y"
  ) %>%
    layout(
      title = "Stock Volatility Comparison (Annualized)",
      xaxis = list(title = "Stock"),
      yaxis = list(title = "Volatility"),
      showlegend = FALSE
    )
  
  saveWidget(vol_plot, "output/volatility_chart.html", selfcontained = TRUE)
  cat("    Saved volatility_chart.html\n")
  
  # 2. Risk-Return Scatter Plot
  cat("  Creating risk-return scatter plot...\n")
  rr_plot <- plot_ly(
    stock_metrics,
    x = ~mean_return * 252,
    y = ~volatility,
    type = "scatter",
    mode = "markers+text",
    text = ~symbol,
    textposition = "top center",
    textfont = list(size = 12),
    marker = list(
      size = ~observations / 50,
      color = ~sharpe_ratio,
      colorscale = "Viridis",
      showscale = TRUE,
      colorbar = list(title = "Sharpe<br>Ratio"),
      line = list(color = "white", width = 1)
    ),
    hoverinfo = "text+x+y+name"
  ) %>%
    layout(
      title = "Risk-Return Profile",
      xaxis = list(title = "Annualized Return"),
      yaxis = list(title = "Annualized Volatility"),
      showlegend = FALSE
    )
  
  saveWidget(rr_plot, "output/risk_return_scatter.html", selfcontained = TRUE)
  cat("    Saved risk_return_scatter.html\n")
  
  # 3. Sharpe Ratio Comparison
  cat("  Creating Sharpe ratio chart...\n")
  sharpe_plot <- plot_ly(
    stock_metrics,
    x = ~symbol,
    y = ~sharpe_ratio,
    type = "bar",
    name = "Sharpe Ratio",
    marker = list(
      color = ~sharpe_ratio,
      colorscale = "RdYlGn",
      showscale = TRUE,
      colorbar = list(title = "Sharpe<br>Ratio")
    ),
    text = ~paste0(sprintf("%.2f", sharpe_ratio), "<br>Observations: ", observations),
    hoverinfo = "text+y"
  ) %>%
    layout(
      title = "Sharpe Ratio Comparison",
      xaxis = list(title = "Stock"),
      yaxis = list(title = "Sharpe Ratio"),
      showlegend = FALSE
    )
  
  saveWidget(sharpe_plot, "output/sharpe_ratio_chart.html", selfcontained = TRUE)
  cat("    Saved sharpe_ratio_chart.html\n")
  
  # 4. Max Drawdown Comparison
  cat("  Creating max drawdown chart...\n")
  drawdown_plot <- plot_ly(
    stock_metrics,
    x = ~symbol,
    y = ~max_drawdown,
    type = "bar",
    name = "Max Drawdown",
    marker = list(color = "#d62728"),
    text = ~paste0(sprintf("%.2f%%", max_drawdown * 100), "<br>Observations: ", observations),
    hoverinfo = "text+y"
  ) %>%
    layout(
      title = "Maximum Drawdown Comparison",
      xaxis = list(title = "Stock"),
      yaxis = list(title = "Max Drawdown"),
      showlegend = FALSE
    )
  
  saveWidget(drawdown_plot, "output/max_drawdown_chart.html", selfcontained = TRUE)
  cat("    Saved max_drawdown_chart.html\n")
  
  # 5. Portfolio Metrics Summary
  cat("  Creating portfolio metrics visualization...\n")
  if (nrow(portfolio_metrics) > 0) {
    portfolio_summary <- data.frame(
      Metric = c("Annualized Return", "Annualized Volatility", "Sharpe Ratio", "Max Drawdown"),
      Value = c(
        portfolio_metrics$mean_return * 252 * 100,
        portfolio_metrics$volatility * 100,
        portfolio_metrics$sharpe_ratio,
        portfolio_metrics$max_drawdown * 100
      ),
      stringsAsFactors = FALSE
    )
    
    portfolio_plot <- plot_ly(
      portfolio_summary,
      x = ~Metric,
      y = ~Value,
      type = "bar",
      marker = list(
        color = c("#2ca02c", "#ff7f0e", "#1f77b4", "#d62728"),
        line = list(color = "white", width = 1)
      ),
      text = ~paste0(sprintf("%.2f", Value), ifelse(Metric %in% c("Annualized Return", "Annualized Volatility", "Max Drawdown"), "%", "")),
      hoverinfo = "text+y"
    ) %>%
      layout(
        title = "Portfolio Risk Metrics Summary",
        xaxis = list(title = ""),
        yaxis = list(title = "Value"),
        showlegend = FALSE
      )
    
    saveWidget(portfolio_plot, "output/portfolio_summary.html", selfcontained = TRUE)
    cat("    Saved portfolio_summary.html\n")
  }
  
  # 6. Combined Dashboard
  cat("  Creating combined dashboard...\n")
  combined <- list(
    vol_plot,
    rr_plot,
    sharpe_plot,
    drawdown_plot
  )
  
  # Create a subplot with the most important charts
  dashboard_plot <- subplot(
    vol_plot,
    rr_plot,
    nrows = 2,
    titleX = TRUE,
    titleY = TRUE,
    margin = 0.05
  )
  
  saveWidget(dashboard_plot, "output/dashboard_combined.html", selfcontained = TRUE)
  cat("    Saved dashboard_combined.html\n")
  
  # Disconnect from database
  dbDisconnect(con)
  
  cat("\nAll visualizations generated successfully!\n")
  cat("Visualizations saved to: output/\n")
  
  # Return list of generated files
  list.files("output/", full.names = TRUE)
}

# Run the function if this script is executed directly
if (interactive() || !exists("db_path")) {
  generated_files <- generate_visualizations()
  cat("\nGenerated files:\n")
  for (file in generated_files) {
    cat(sprintf("  - %s\n", basename(file)))
  }
}
