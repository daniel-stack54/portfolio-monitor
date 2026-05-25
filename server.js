'use strict';
const express = require('express');
const path    = require('path');
const yf      = require('yahoo-finance2').default;

const { evaluarActivo, ordenarPorFuerzaSenal } = require('./scoringEngine');
const { PORTFOLIO_PERSONAL, calcularPesosPortfolio } = require('./portfolio');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

// ── Technical indicators ──────────────────────────────────────────────────────

function calcEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcRSISeries(closes, period = 14) {
  if (closes.length < period + 1) return [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  const rsi = [avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)];
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14) {
  const series = calcRSISeries(closes, rsiPeriod);
  if (series.length < stochPeriod) return null;
  const recent = series.slice(-stochPeriod);
  const cur = recent[recent.length - 1];
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  return max === min ? 50 : ((cur - min) / (max - min)) * 100;
}

// ── Yahoo Finance helpers ─────────────────────────────────────────────────────

function period1YearAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

async function fetchTickerData(ticker) {
  try {
    const [histRes, quoteRes, summaryRes] = await Promise.allSettled([
      yf.historical(ticker, { period1: period1YearAgo(), interval: '1d' }),
      yf.quote(ticker),
      yf.quoteSummary(ticker, {
        modules: ['calendarEvents', 'financialData'],
        suppressNotices: ['yahooFinanceType']
      })
    ]);

    // ── Candles + indicators ──────────────────────────────────────────────────
    let chartData = null;
    if (histRes.status === 'fulfilled' && histRes.value?.length >= 30) {
      const bars   = histRes.value.filter(b => b.close != null);
      const closes = bars.map(b => b.close);
      const velas  = bars.slice(-35).map(b => ({
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0
      }));

      const q        = quoteRes.status === 'fulfilled' ? quoteRes.value : null;
      const precio   = q?.regularMarketPrice   ?? closes[closes.length - 1];
      const prevClose= q?.regularMarketPreviousClose ?? closes[closes.length - 2];

      chartData = {
        precio,
        hoyPct:   prevClose ? ((precio - prevClose) / prevClose) * 100 : 0,
        ema20:    calcEMA(closes, 20),
        ema50:    calcEMA(closes, 50),
        ema200:   calcEMA(closes, 200),
        stochRsi: calcStochRSI(closes),
        velas
      };
    }

    // ── Earnings date ─────────────────────────────────────────────────────────
    let earnings = null;
    if (summaryRes.status === 'fulfilled') {
      const edArr = summaryRes.value?.calendarEvents?.earnings?.earningsDate;
      if (edArr?.length) {
        const raw = edArr[0];
        const d   = raw instanceof Date ? raw : new Date(raw * 1000);
        if (!isNaN(d)) {
          earnings = d.toLocaleDateString('es-ES', {
            day: '2-digit', month: 'short', timeZone: 'UTC'
          });
        }
      }
    }

    // ── Analyst rating ────────────────────────────────────────────────────────
    let rating = null;
    if (summaryRes.status === 'fulfilled') {
      const rec = summaryRes.value?.financialData?.recommendationKey;
      const MAP = {
        strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold',
        underperform: 'Sell', sell: 'Strong Sell'
      };
      rating = rec ? (MAP[rec] ?? rec) : null;
    }

    return { chartData, earnings, rating };
  } catch (err) {
    console.error(`  [${ticker}] ${err.message}`);
    return { chartData: null, earnings: null, rating: null };
  }
}

async function fetchSPX() {
  try {
    const bars = await yf.historical('^GSPC', { period1: period1YearAgo(), interval: '1d' });
    if (!bars?.length) return null;
    const closes = bars.filter(b => b.close != null).map(b => b.close);
    const q      = await yf.quote('^GSPC');
    return {
      precio: q?.regularMarketPrice ?? closes[closes.length - 1],
      ema20:  calcEMA(closes, 20)
    };
  } catch { return null; }
}

// ── SPX state label ───────────────────────────────────────────────────────────

function calcSPXState(precio, ema20) {
  if (!precio || !ema20) return { estado: 'DESCONOCIDO', dist: null };
  const dist = ((precio - ema20) / ema20) * 100;
  let estado;
  if      (dist >= -2 && dist <= 1)  estado = 'FAVORABLE';
  else if (dist > 1   && dist <= 2.5)estado = 'EXTENDIDO_LEVE';
  else if (dist > 2.5)               estado = 'EXTENDIDO';
  else if (dist >= -4)               estado = 'CORRECCION_LEVE';
  else                               estado = 'CORRECCION_FUERTE';
  return { estado, dist: Math.round(dist * 100) / 100 };
}

// ── In-memory cache (3 min) ───────────────────────────────────────────────────

let _cache = null, _cacheTs = 0;
const CACHE_TTL = 3 * 60 * 1000;

async function buildData() {
  const tickers = PORTFOLIO_PERSONAL.map(p => p.ticker);
  const tickerMap = {};
  const BATCH = 5;

  console.log(`Fetching ${tickers.length} tickers in batches of ${BATCH}…`);
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    process.stdout.write(`  [${i + 1}-${Math.min(i + BATCH, tickers.length)}/${tickers.length}] ${batch.join(', ')}\n`);
    const results = await Promise.allSettled(batch.map(t => fetchTickerData(t)));
    results.forEach((r, j) => {
      tickerMap[batch[j]] = r.status === 'fulfilled'
        ? r.value
        : { chartData: null, earnings: null, rating: null };
    });
    if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 350));
  }

  // SPX
  console.log('  Fetching SPX…');
  const spxRaw   = await fetchSPX();
  const spxState = spxRaw ? calcSPXState(spxRaw.precio, spxRaw.ema20) : null;
  const spx      = spxRaw ? { ...spxRaw, ...spxState } : null;

  // Build portfolio with weights
  const preciosActuales = {};
  Object.entries(tickerMap).forEach(([t, d]) => {
    if (d.chartData?.precio) preciosActuales[t] = d.chartData.precio;
  });

  const conPesos = calcularPesosPortfolio(PORTFOLIO_PERSONAL, preciosActuales);

  const resultados = conPesos.map(pos => {
    const d = tickerMap[pos.ticker];
    if (!d?.chartData) {
      return {
        ...pos, senal: 'SIN_DATOS', alertas: [],
        cantidadAlertas: 0, hoyPct: null, earnings: null, rating: null
      };
    }
    const { chartData, earnings, rating } = d;
    const scoring = evaluarActivo({
      ticker:    pos.ticker,
      precio:    chartData.precio,
      ema20:     chartData.ema20,
      ema50:     chartData.ema50,
      ema200:    chartData.ema200,
      stochRsi:  chartData.stochRsi,
      velas:     chartData.velas,
      spxPrecio: spxRaw?.precio,
      spxEma20:  spxRaw?.ema20
    });
    return {
      ...pos,
      precioActual:    chartData.precio,
      hoyPct:          chartData.hoyPct,
      earnings,
      rating,
      senal:           scoring.senal,
      razon:           scoring.razon,
      alertas:         scoring.alertas,
      cantidadAlertas: scoring.cantidadAlertas || 0
    };
  });

  const ordenados = ordenarPorFuerzaSenal(resultados);

  const contadores = {};
  ordenados.forEach(r => { contadores[r.senal] = (contadores[r.senal] || 0) + 1; });

  console.log('Done. Counters:', JSON.stringify(contadores));
  return { portfolio: ordenados, spx, contadores, timestamp: new Date().toISOString() };
}

async function getData(force = false) {
  if (!force && _cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
  _cache  = await buildData();
  _cacheTs = Date.now();
  return _cache;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/portfolio', async (req, res) => {
  try   { res.json(await getData()); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/refresh', async (req, res) => {
  try   { res.json(await getData(true)); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () =>
  console.log(`\nPortfolio Monitor v3.0 → http://localhost:${PORT}\n`)
);
