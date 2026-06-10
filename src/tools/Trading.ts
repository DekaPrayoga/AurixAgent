import { exec } from 'child_process';
import type { Tool } from './Registry.js';

export const tradingTool: Tool = {
  name: 'trading',
  description: 'Trading analysis and research: stock analysis, technical indicators, sentiment analysis, market data, portfolio tracking, risk assessment. Multi-agent trading system with bull/bear researchers, analysts, and risk management.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: analyze, sentiment, technical, news, portfolio, compare, risk, report',
      },
      symbol: {
        type: 'string',
        description: 'Stock/crypto ticker symbol',
      },
      period: {
        type: 'string',
        description: 'Time period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 5y (default: 1mo)',
      },
      comparison: {
        type: 'string',
        description: 'Comparison symbol for relative analysis',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;
    const symbol = (args.symbol as string) || '';
    const period = (args.period as string) || '1mo';

    switch (action) {
      case 'analyze':
        return fullAnalysis(symbol, period);
      case 'sentiment':
        return sentimentAnalysis(symbol);
      case 'technical':
        return technicalAnalysis(symbol, period);
      case 'news':
        return newsAnalysis(symbol);
      case 'portfolio':
        return portfolioView();
      case 'compare':
        return compareStocks(symbol, args.comparison as string, period);
      case 'risk':
        return riskAssessment(symbol);
      case 'report':
        return tradingReport(symbol, period);
      default:
        return `Unknown action: ${action}`;
    }
  },
};

function runCmd(cmd: string, timeout = 30000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve(stderr?.trim() || `Error: ${err.message}`);
      else resolve(stdout.trim());
    });
  });
}

function pyScript(code: string): string {
  return `python3 -c "${code.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" 2>&1`;
}

async function fullAnalysis(symbol: string, period: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const script = `
import json, sys
try:
    import yfinance as yf
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', '-q'])
    import yfinance as yf

t = yf.Ticker("${symbol}")
info = t.info or {}
hist = t.history(period="${period}")

result = {
    "symbol": "${symbol}".upper(),
    "name": info.get("shortName", "N/A"),
    "price": info.get("currentPrice") or info.get("regularMarketPrice", "N/A"),
    "change": info.get("regularMarketChangePercent", "N/A"),
    "market_cap": info.get("marketCap", "N/A"),
    "pe_ratio": info.get("trailingPE", "N/A"),
    "52w_high": info.get("fiftyTwoWeekHigh", "N/A"),
    "52w_low": info.get("fiftyTwoWeekLow", "N/A"),
    "volume": info.get("volume", "N/A"),
    "avg_volume": info.get("averageVolume", "N/A"),
    "dividend_yield": info.get("dividendYield", "N/A"),
    "sector": info.get("sector", "N/A"),
    "industry": info.get("industry", "N/A"),
    "history_rows": len(hist) if hist is not None else 0,
}
print(json.dumps(result, indent=2, default=str))
`;

  return `Full Analysis: ${symbol.toUpperCase()}\n${await runCmd(pyScript(script), 60000)}`;
}

async function sentimentAnalysis(symbol: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const newsScript = `
import json, sys
try:
    import yfinance as yf
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', '-q'])
    import yfinance as yf

t = yf.Ticker("${symbol}")
news = t.news or []

results = []
for n in news[:10]:
    results.append({
        "title": n.get("title", ""),
        "publisher": n.get("publisher", ""),
        "link": n.get("link", ""),
    })

print(json.dumps(results, indent=2, default=str))
print(f"\\nTotal news items: {len(news)}")
`;

  return `Sentiment Analysis: ${symbol.toUpperCase()}\n${await runCmd(pyScript(newsScript), 30000)}`;
}

async function technicalAnalysis(symbol: string, period: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const script = `
import json, sys
try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', 'pandas', '-q'])
    import yfinance as yf
    import pandas as pd

t = yf.Ticker("${symbol}")
hist = t.history(period="${period}")

if hist.empty:
    print("No data available")
    sys.exit(0)

close = hist['Close']
sma20 = close.rolling(20).mean().iloc[-1] if len(close) >= 20 else None
sma50 = close.rolling(50).mean().iloc[-1] if len(close) >= 50 else None
rsi_delta = close.diff()
gain = rsi_delta.where(rsi_delta > 0, 0).rolling(14).mean().iloc[-1]
loss = (-rsi_delta.where(rsi_delta < 0, 0)).rolling(14).mean().iloc[-1]
rsi = 100 - (100 / (1 + gain / loss)) if loss > 0 else 100

result = {
    "current_price": round(float(close.iloc[-1]), 2),
    "sma_20": round(float(sma20), 2) if sma20 else None,
    "sma_50": round(float(sma50), 2) if sma50 else None,
    "rsi_14": round(float(rsi), 2),
    "high_period": round(float(close.max()), 2),
    "low_period": round(float(close.min()), 2),
    "avg_volume": int(hist['Volume'].mean()) if 'Volume' in hist else None,
    "trend": "BULLISH" if sma20 and close.iloc[-1] > sma20 else "BEARISH",
    "signal": "OVERBOUGHT" if rsi > 70 else "OVERSOLD" if rsi < 30 else "NEUTRAL",
}
print(json.dumps(result, indent=2, default=str))
`;

  return `Technical Analysis: ${symbol.toUpperCase()}\n${await runCmd(pyScript(script), 60000)}`;
}

async function newsAnalysis(symbol: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const script = `
import json, sys
try:
    import yfinance as yf
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', '-q'])
    import yfinance as yf

t = yf.Ticker("${symbol}")
news = t.news or []

for i, n in enumerate(news[:15], 1):
    print(f"{i}. {n.get('title', 'No title')}")
    print(f"   Publisher: {n.get('publisher', 'Unknown')}")
    print(f"   Link: {n.get('link', '')}")
    print()
`;

  return `News: ${symbol.toUpperCase()}\n${await runCmd(pyScript(script), 30000)}`;
}

async function portfolioView(): Promise<string> {
  return `Portfolio tracking: add symbols with trading analyze <SYMBOL>\nFor full portfolio management, use the trading agents multi-agent system:\n  /multiagent on\n  Then ask: "Analyze my portfolio: AAPL, GOOGL, MSFT"`;
}

async function compareStocks(symbol: string, comparison: string, period: string): Promise<string> {
  if (!symbol || !comparison) return 'Error: provide two symbols to compare';

  const script = `
import json, sys
try:
    import yfinance as yf
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', '-q'])
    import yfinance as yf

results = {}
for sym in ["${symbol}", "${comparison}"]:
    t = yf.Ticker(sym)
    info = t.info or {}
    hist = t.history(period="${period}")
    results[sym] = {
        "price": info.get("currentPrice") or info.get("regularMarketPrice"),
        "change_pct": info.get("regularMarketChangePercent"),
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "period_return": round((float(hist['Close'].iloc[-1]) / float(hist['Close'].iloc[0]) - 1) * 100, 2) if not hist.empty and len(hist) > 1 else None,
    }
print(json.dumps(results, indent=2, default=str))
`;

  return `Comparison: ${symbol.toUpperCase()} vs ${comparison.toUpperCase()}\n${await runCmd(pyScript(script), 60000)}`;
}

async function riskAssessment(symbol: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const script = `
import json, sys
try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'yfinance', 'pandas', '-q'])
    import yfinance as yf
    import pandas as pd

t = yf.Ticker("${symbol}")
info = t.info or {}
hist = t.history(period="1y")

if not hist.empty and len(hist) > 1:
    returns = hist['Close'].pct_change().dropna()
    volatility = float(returns.std() * (252 ** 0.5) * 100)
    max_drawdown = float((hist['Close'] / hist['Close'].cummax() - 1).min() * 100)
    sharpe = float(returns.mean() / returns.std() * (252 ** 0.5)) if returns.std() > 0 else 0
else:
    volatility = max_drawdown = sharpe = None

result = {
    "beta": info.get("beta", "N/A"),
    "annualized_volatility": f"{volatility:.2f}%" if volatility else "N/A",
    "max_drawdown": f"{max_drawdown:.2f}%" if max_drawdown else "N/A",
    "sharpe_ratio": f"{sharpe:.2f}" if sharpe else "N/A",
    "debt_to_equity": info.get("debtToEquity", "N/A"),
    "current_ratio": info.get("currentRatio", "N/A"),
    "risk_level": "HIGH" if volatility and volatility > 40 else "MEDIUM" if volatility and volatility > 20 else "LOW",
}
print(json.dumps(result, indent=2, default=str))
`;

  return `Risk Assessment: ${symbol.toUpperCase()}\n${await runCmd(pyScript(script), 60000)}`;
}

async function tradingReport(symbol: string, period: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const results = await Promise.all([
    fullAnalysis(symbol, period),
    technicalAnalysis(symbol, period),
    riskAssessment(symbol),
  ]);

  return `=== TRADING REPORT: ${symbol.toUpperCase()} ===\n\n${results.join('\n\n---\n\n')}`;
}
