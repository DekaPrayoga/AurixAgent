import type { Tool } from './Registry.js';

type Quote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  marketCap?: number;
  trailingPE?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  dividendYield?: number;
  beta?: number;
  epsTrailingTwelveMonths?: number;
  currency?: string;
};

type ChartPoint = { close: number; volume: number; timestamp: number };

export const tradingTool: Tool = {
  name: 'trading',
  description:
    'Trading analysis and research using public Yahoo Finance market data: stock analysis, technical indicators, news, comparison, and risk assessment. No Python/yfinance dependency required.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Action: analyze, sentiment, technical, news, portfolio, compare, risk, report',
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
    const action = String(args.action || '');
    const symbol = String(args.symbol || '')
      .trim()
      .toUpperCase();
    const period = String(args.period || '1mo');

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
        return compareStocks(
          symbol,
          String(args.comparison || '')
            .trim()
            .toUpperCase(),
          period
        );
      case 'risk':
        return riskAssessment(symbol);
      case 'report':
        return tradingReport(symbol, period);
      default:
        return `Unknown action: ${action}`;
    }
  },
};

function intervalForPeriod(period: string): string {
  if (period === '1d') return '5m';
  if (period === '5d') return '15m';
  if (period === '5y') return '1wk';
  return '1d';
}

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'N/A';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'N/A';
    if (Math.abs(value) >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function pct(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : 'N/A';
}

async function yahooJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 AurixAgent/Trading',
    },
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`Yahoo Finance HTTP ${resp.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body) as T;
}

async function getQuote(symbol: string): Promise<Quote> {
  const encoded = encodeURIComponent(symbol);
  const [search, chart] = await Promise.all([
    yahooJson<any>(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&newsCount=0&quotesCount=1`
    ).catch(() => ({})),
    yahooJson<any>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=5m`
    ).catch(() => ({})),
  ]);
  const searchQuote =
    search.quotes?.find((q: any) => String(q.symbol || '').toUpperCase() === symbol) ||
    search.quotes?.[0] ||
    {};
  const chartResult = chart.chart?.result?.[0] || {};
  const meta = chartResult.meta || {};
  if (!searchQuote.symbol && !meta.symbol) throw new Error(`No quote data returned for ${symbol}`);
  return {
    symbol: meta.symbol || searchQuote.symbol || symbol,
    shortName: searchQuote.shortname || searchQuote.shortName,
    longName: searchQuote.longname || searchQuote.longName || meta.longName,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketPreviousClose: meta.previousClose,
    regularMarketChangePercent:
      typeof meta.regularMarketPrice === 'number' &&
      typeof meta.previousClose === 'number' &&
      meta.previousClose !== 0
        ? (meta.regularMarketPrice / meta.previousClose - 1) * 100
        : undefined,
    regularMarketVolume: meta.regularMarketVolume,
    averageDailyVolume3Month: meta.averageDailyVolume3Month,
    marketCap: searchQuote.marketCap,
    trailingPE: searchQuote.trailingPE,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    dividendYield: searchQuote.dividendYield,
    beta: searchQuote.beta,
    epsTrailingTwelveMonths: searchQuote.epsTrailingTwelveMonths,
    currency: meta.currency || searchQuote.currency,
  };
}

async function getChart(symbol: string, period: string): Promise<ChartPoint[]> {
  const encoded = encodeURIComponent(symbol);
  const data = await yahooJson<any>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${encodeURIComponent(period)}&interval=${intervalForPeriod(period)}`
  );
  const result = data.chart?.result?.[0];
  if (!result) return [];
  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes: Array<number | null> = quote.close || [];
  const volumes: Array<number | null> = quote.volume || [];
  return timestamps
    .map((timestamp, i) => ({
      timestamp,
      close: Number(closes[i]),
      volume: Number(volumes[i] || 0),
    }))
    .filter((point) => Number.isFinite(point.close) && point.close > 0);
}

async function getNews(symbol: string): Promise<any[]> {
  const encoded = encodeURIComponent(symbol);
  const data = await yahooJson<any>(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&newsCount=12&quotesCount=0`
  );
  return Array.isArray(data.news) ? data.news : [];
}

function sma(values: number[], window: number): number | undefined {
  if (values.length < window) return undefined;
  const slice = values.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function rsi(values: number[], window = 14): number | undefined {
  if (values.length <= window) return undefined;
  let gains = 0;
  let losses = 0;
  const slice = values.slice(-window - 1);
  for (let i = 1; i < slice.length; i++) {
    const delta = slice[i] - slice[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  const avgGain = gains / window;
  const avgLoss = losses / window;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function returns(points: ChartPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push(points[i].close / points[i - 1].close - 1);
  }
  return out.filter((value) => Number.isFinite(value));
}

function stdev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdown(points: ChartPoint[]): number | undefined {
  if (points.length < 2) return undefined;
  let peak = points[0].close;
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point.close);
    worst = Math.min(worst, point.close / peak - 1);
  }
  return worst * 100;
}

async function fullAnalysis(symbol: string, period: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  try {
    const [quote, chart] = await Promise.all([getQuote(symbol), getChart(symbol, period)]);
    const name = quote.longName || quote.shortName || symbol;
    return [
      `Full Analysis: ${symbol}`,
      `Name: ${name}`,
      `Price: ${fmt(quote.regularMarketPrice)} ${quote.currency || ''}`.trim(),
      `Change: ${pct(quote.regularMarketChangePercent)}`,
      `Market cap: ${fmt(quote.marketCap)}`,
      `P/E ratio: ${fmt(quote.trailingPE)}`,
      `52w high / low: ${fmt(quote.fiftyTwoWeekHigh)} / ${fmt(quote.fiftyTwoWeekLow)}`,
      `Volume / avg volume: ${fmt(quote.regularMarketVolume)} / ${fmt(quote.averageDailyVolume3Month)}`,
      `Dividend yield: ${pct(typeof quote.dividendYield === 'number' ? quote.dividendYield * 100 : undefined)}`,
      `Beta: ${fmt(quote.beta)}`,
      `History rows (${period}): ${chart.length}`,
      '',
      'Not financial advice. Use this as market data context only.',
    ].join('\n');
  } catch (e: any) {
    return `Trading analysis failed for ${symbol}: ${e.message}`;
  }
}

async function sentimentAnalysis(symbol: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';
  return newsAnalysis(symbol);
}

async function technicalAnalysis(symbol: string, period: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  try {
    const points = await getChart(symbol, period);
    if (points.length === 0) return `Technical Analysis: ${symbol}\nNo chart data available.`;
    const closes = points.map((point) => point.close);
    const current = closes[closes.length - 1];
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const rsi14 = rsi(closes, 14);
    const avgVolume = points.reduce((sum, point) => sum + point.volume, 0) / points.length;
    const trend = sma20 && current > sma20 ? 'BULLISH' : 'BEARISH';
    const signal =
      rsi14 && rsi14 > 70 ? 'OVERBOUGHT' : rsi14 && rsi14 < 30 ? 'OVERSOLD' : 'NEUTRAL';

    return [
      `Technical Analysis: ${symbol}`,
      `Current price: ${fmt(current)}`,
      `SMA 20: ${fmt(sma20)}`,
      `SMA 50: ${fmt(sma50)}`,
      `RSI 14: ${fmt(rsi14)}`,
      `Period high / low: ${fmt(Math.max(...closes))} / ${fmt(Math.min(...closes))}`,
      `Average volume: ${fmt(avgVolume)}`,
      `Trend: ${trend}`,
      `Signal: ${signal}`,
      '',
      'Not financial advice. Technical indicators can lag and fail.',
    ].join('\n');
  } catch (e: any) {
    return `Technical analysis failed for ${symbol}: ${e.message}`;
  }
}

async function newsAnalysis(symbol: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  try {
    const news = await getNews(symbol);
    if (news.length === 0) return `News: ${symbol}\nNo recent Yahoo Finance news found.`;
    const lines = news.slice(0, 10).map((item, i) => {
      const title = item.title || 'No title';
      const publisher = item.publisher || item.source || 'Unknown';
      const link = item.link || '';
      return `${i + 1}. ${title}\n   Publisher: ${publisher}${link ? `\n   Link: ${link}` : ''}`;
    });
    return `News: ${symbol}\n${lines.join('\n\n')}`;
  } catch (e: any) {
    return `News lookup failed for ${symbol}: ${e.message}`;
  }
}

async function portfolioView(): Promise<string> {
  return `Portfolio tracking: add symbols with trading analyze <SYMBOL>\nFor full portfolio management, use the trading agents multi-agent system:\n  /multiagent on\n  Then ask: "Analyze my portfolio: AAPL, GOOGL, MSFT"`;
}

async function compareStocks(symbol: string, comparison: string, period: string): Promise<string> {
  if (!symbol || !comparison) return 'Error: provide two symbols to compare';

  try {
    const [aQuote, bQuote, aChart, bChart] = await Promise.all([
      getQuote(symbol),
      getQuote(comparison),
      getChart(symbol, period),
      getChart(comparison, period),
    ]);
    const periodReturn = (points: ChartPoint[]) =>
      points.length > 1 ? (points[points.length - 1].close / points[0].close - 1) * 100 : undefined;

    return [
      `Comparison: ${symbol} vs ${comparison}`,
      '',
      `| Metric | ${symbol} | ${comparison} |`,
      '|---|---:|---:|',
      `| Price | ${fmt(aQuote.regularMarketPrice)} | ${fmt(bQuote.regularMarketPrice)} |`,
      `| Change | ${pct(aQuote.regularMarketChangePercent)} | ${pct(bQuote.regularMarketChangePercent)} |`,
      `| Market cap | ${fmt(aQuote.marketCap)} | ${fmt(bQuote.marketCap)} |`,
      `| P/E | ${fmt(aQuote.trailingPE)} | ${fmt(bQuote.trailingPE)} |`,
      `| ${period} return | ${pct(periodReturn(aChart))} | ${pct(periodReturn(bChart))} |`,
      '',
      'Not financial advice.',
    ].join('\n');
  } catch (e: any) {
    return `Comparison failed: ${e.message}`;
  }
}

async function riskAssessment(symbol: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  try {
    const [quote, chart] = await Promise.all([getQuote(symbol), getChart(symbol, '1y')]);
    const ret = returns(chart);
    const dailyVol = stdev(ret);
    const annualizedVol = dailyVol ? dailyVol * Math.sqrt(252) * 100 : undefined;
    const drawdown = maxDrawdown(chart);
    const avgReturn = ret.length
      ? ret.reduce((sum, value) => sum + value, 0) / ret.length
      : undefined;
    const sharpe =
      dailyVol && avgReturn !== undefined ? (avgReturn / dailyVol) * Math.sqrt(252) : undefined;
    const riskLevel =
      annualizedVol && annualizedVol > 40
        ? 'HIGH'
        : annualizedVol && annualizedVol > 20
          ? 'MEDIUM'
          : 'LOW';

    return [
      `Risk Assessment: ${symbol}`,
      `Beta: ${fmt(quote.beta)}`,
      `Annualized volatility: ${pct(annualizedVol)}`,
      `Max drawdown: ${pct(drawdown)}`,
      `Sharpe ratio: ${fmt(sharpe)}`,
      `Risk level: ${riskLevel}`,
      '',
      'Not financial advice. Risk metrics are historical and may not predict future losses.',
    ].join('\n');
  } catch (e: any) {
    return `Risk assessment failed for ${symbol}: ${e.message}`;
  }
}

async function tradingReport(symbol: string, period: string): Promise<string> {
  if (!symbol) return 'Error: provide a ticker symbol';

  const results = await Promise.all([
    fullAnalysis(symbol, period),
    technicalAnalysis(symbol, period),
    riskAssessment(symbol),
  ]);

  return `=== TRADING REPORT: ${symbol} ===\n\n${results.join('\n\n---\n\n')}`;
}
