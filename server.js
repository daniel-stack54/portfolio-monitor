'use strict';
const express = require('express');
const path    = require('path');
const axios   = require('axios');
const https   = require('https');
const fs      = require('fs');

const { evaluarActivo, ordenarPorFuerzaSenal } = require('./scoringEngine');
const { PORTFOLIO_PERSONAL, calcularPesosPortfolio } = require('./portfolio');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Yahoo Finance HTTP client ─────────────────────────────────────────────────

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/'
};

let _crumb = null, _cookies = '';
let _crumbPromise = null;

async function refreshCrumb() {
  // Singleton: only one refresh runs at a time
  if (_crumbPromise) return _crumbPromise;
  _crumbPromise = (async () => {
    try {
      const r1 = await axios.get('https://finance.yahoo.com/', {
        headers: YF_HEADERS, maxRedirects: 3, timeout: 15000,
        maxContentLength: 5 * 1024 * 1024
      });
      _cookies = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const r2 = await axios.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { ...YF_HEADERS, Cookie: _cookies }, timeout: 8000
      });
      _crumb = typeof r2.data === 'string' ? r2.data.trim() : '';
      if (_crumb) console.log(`  YF crumb OK: ${_crumb}`);
      else console.warn('  Crumb empty — proceeding without');
    } catch (e) {
      console.warn('  Crumb fetch failed:', e.message);
      _crumb = '';
    }
  })();
  await _crumbPromise;
  _crumbPromise = null;
}

async function yfGet(url, params = {}) {
  if (_crumb === null) await refreshCrumb();
  const p = { ...params };
  if (_crumb) p.crumb = _crumb;
  const headers = { ...YF_HEADERS };
  if (_cookies) headers.Cookie = _cookies;
  try {
    return await axios.get(url, { params: p, headers, timeout: 13000 });
  } catch (e) {
    if (e.response?.status === 401 && _crumb) {
      // Only refresh crumb if it was previously valid
      _crumb = null;
      await refreshCrumb();
      if (_crumb) p.crumb = _crumb;
      return axios.get(url, { params: p, headers: { ...YF_HEADERS, Cookie: _cookies }, timeout: 13000 });
    }
    throw e;
  }
}

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
  avgGain /= period; avgLoss /= period;
  const rsi = [avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)];
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calcStochRSI(closes) {
  const series = calcRSISeries(closes, 14);
  if (series.length < 14) return null;
  const recent = series.slice(-14);
  const cur = recent[recent.length - 1];
  const min = Math.min(...recent), max = Math.max(...recent);
  return max === min ? 50 : +((( cur - min) / (max - min)) * 100).toFixed(1);
}

// ── Yahoo Finance data fetch ───────────────────────────────────────────────────

async function fetchChart(ticker) {
  const res = await yfGet(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
    { range: '1y', interval: '1d', events: 'div,split' }
  );
  const result = res.data?.chart?.result?.[0];
  if (!result) return null;

  const meta  = result.meta;
  const quote = result.indicators?.quote?.[0];
  if (!quote) return null;

  const velas = [];
  for (let i = 0; i < (result.timestamp?.length || 0); i++) {
    const o = quote.open?.[i], c = quote.close?.[i];
    if (o != null && c != null) {
      velas.push({ open: o, high: quote.high?.[i] ?? c, low: quote.low?.[i] ?? c, close: c, volume: quote.volume?.[i] ?? 0 });
    }
  }
  if (velas.length < 30) return null;

  const closes  = velas.map(v => v.close);
  const precio  = meta.regularMarketPrice;
  const prev    = meta.previousClose ?? meta.chartPreviousClose ?? closes[closes.length - 2];
  const ema20   = calcEMA(closes, 20);
  const ema50   = calcEMA(closes, 50);
  const ema200  = calcEMA(closes, 200);
  const stRsi   = calcStochRSI(closes);

  return {
    precio,
    hoyPct:   prev ? +((( precio - prev) / prev) * 100).toFixed(2) : 0,
    ema20,  ema50,  ema200,
    stochRsi: stRsi,
    distEma20:  ema20  ? +(((precio - ema20)  / ema20)  * 100).toFixed(2) : null,
    distEma50:  ema50  ? +(((precio - ema50)  / ema50)  * 100).toFixed(2) : null,
    distEma200: ema200 ? +(((precio - ema200) / ema200) * 100).toFixed(2) : null,
    velas: velas.slice(-35)
  };
}

async function fetchSummary(ticker) {
  const res = await yfGet(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
    { modules: 'calendarEvents,financialData' }
  );
  const r = res.data?.quoteSummary?.result?.[0];
  if (!r) return { earnings: null, rating: null, targetPrice: null };

  // Earnings date
  let earnings = null;
  const ed = r.calendarEvents?.earnings?.earningsDate?.[0];
  if (ed) {
    const ts  = ed?.raw ?? (typeof ed === 'number' ? ed : null);
    if (ts) {
      const d = new Date(ts * 1000);
      if (!isNaN(d)) earnings = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    }
  }

  // Analyst rating
  const recKey = r.financialData?.recommendationKey;
  const REC = { strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold', underperform: 'Sell', sell: 'Strong Sell' };
  const rating = recKey ? (REC[recKey] || recKey) : null;

  // Target price
  const tp = r.financialData?.targetMeanPrice?.raw ?? r.financialData?.targetMeanPrice ?? null;

  return { earnings, rating, targetPrice: tp ? +tp.toFixed(2) : null };
}

async function fetchNews(ticker) {
  try {
    const res = await yfGet('https://query2.finance.yahoo.com/v2/finance/news', { symbols: ticker, newsCount: 4 });
    return (res.data?.items?.result || []).slice(0, 4).map(n => ({
      title:     n.title,
      publisher: n.publisher,
      link:      n.link,
      pubDate:   n.pubTime ? new Date(n.pubTime * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : null
    }));
  } catch { return []; }
}

async function fetchTickerAll(ticker) {
  try {
    const [chartRes, summaryRes, newsRes] = await Promise.allSettled([
      fetchChart(ticker),
      fetchSummary(ticker),
      fetchNews(ticker)
    ]);
    return {
      chart:   chartRes.status   === 'fulfilled' ? chartRes.value   : null,
      summary: summaryRes.status === 'fulfilled' ? summaryRes.value : { earnings: null, rating: null, targetPrice: null },
      news:    newsRes.status    === 'fulfilled' ? newsRes.value    : []
    };
  } catch (err) {
    console.error(`  [${ticker}] ${err.message}`);
    return { chart: null, summary: { earnings: null, rating: null, targetPrice: null }, news: [] };
  }
}

// ── SPX ───────────────────────────────────────────────────────────────────────

async function fetchSPX() {
  try {
    const data = await fetchChart('^GSPC');
    if (!data) return null;
    const dist = data.ema20 ? +(((data.precio - data.ema20) / data.ema20) * 100).toFixed(2) : null;
    let estado = 'DESCONOCIDO';
    if (dist !== null) {
      if      (dist >= -2 && dist <= 1)  estado = 'FAVORABLE';
      else if (dist > 1   && dist <= 2.5)estado = 'EXTENDIDO_LEVE';
      else if (dist > 2.5)               estado = 'EXTENDIDO';
      else if (dist >= -4)               estado = 'CORRECCION_LEVE';
      else                               estado = 'CORRECCION_FUERTE';
    }
    return { precio: data.precio, ema20: data.ema20, dist, estado };
  } catch { return null; }
}

// ── Build portfolio data ──────────────────────────────────────────────────────

let _cache = null, _cacheTs = 0;
let _building = false;
const CACHE_TTL = 5 * 60 * 1000;

async function buildData() {
  const tickers = PORTFOLIO_PERSONAL.map(p => p.ticker);
  const map = {};
  const BATCH = 8;

  console.log(`\nFetching ${tickers.length} tickers from Yahoo Finance…`);
  if (_crumb === null) await refreshCrumb();  // single crumb init before batch
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    process.stdout.write(`  [${String(i + 1).padStart(2)}-${String(Math.min(i + BATCH, tickers.length)).padStart(2)}/${tickers.length}] ${batch.join(', ')}\n`);
    const results = await Promise.allSettled(batch.map(t => fetchTickerAll(t)));
    results.forEach((r, j) => {
      map[batch[j]] = r.status === 'fulfilled' ? r.value : { chart: null, summary: { earnings: null, rating: null, targetPrice: null }, news: [] };
    });
    if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 150));
  }

  process.stdout.write('  [SPX] ^GSPC\n');
  const spx = await fetchSPX();

  const preciosActuales = {};
  Object.entries(map).forEach(([t, d]) => { if (d.chart?.precio) preciosActuales[t] = d.chart.precio; });

  const conPesos = calcularPesosPortfolio(PORTFOLIO_PERSONAL, preciosActuales);

  const resultados = conPesos.map(pos => {
    const d = map[pos.ticker];
    if (!d?.chart) {
      return { ...pos, senal: 'SIN_DATOS', alertas: [], cantidadAlertas: 0,
               hoyPct: null, earnings: null, rating: null, targetPrice: null, news: [] };
    }
    const { chart, summary, news } = d;
    const scoring = evaluarActivo({
      ticker: pos.ticker, precio: chart.precio,
      ema20: chart.ema20, ema50: chart.ema50, ema200: chart.ema200,
      stochRsi: chart.stochRsi, velas: chart.velas,
      spxPrecio: spx?.precio, spxEma20: spx?.ema20
    });
    return {
      ...pos,
      precioActual:    chart.precio,
      hoyPct:          chart.hoyPct,
      // Indicator values for display
      ema20:           chart.ema20,
      ema50:           chart.ema50,
      ema200:          chart.ema200,
      distEma20:       chart.distEma20,
      distEma50:       chart.distEma50,
      distEma200:      chart.distEma200,
      stochRsi:        chart.stochRsi,
      // Summary
      earnings:        summary.earnings,
      rating:          summary.rating,
      targetPrice:     summary.targetPrice,
      news,
      // Signal
      senal:           scoring.senal,
      razon:           scoring.razon,
      alertas:         scoring.alertas,
      cantidadAlertas: scoring.cantidadAlertas || 0
    };
  });

  const ordenados = ordenarPorFuerzaSenal(resultados);
  const contadores = {};
  ordenados.forEach(r => { contadores[r.senal] = (contadores[r.senal] || 0) + 1; });

  const total     = ordenados.reduce((s, p) => s + (p.valorActual  || 0), 0);
  const totalCost = ordenados.reduce((s, p) => s + (p.valorEntrada || 0), 0);
  const plGlobal  = totalCost > 0 ? ((total / totalCost) - 1) * 100 : 0;

  console.log('Contadores:', JSON.stringify(contadores));
  return {
    portfolio: ordenados, spx, contadores,
    resumen: { total: +total.toFixed(2), totalCost: +totalCost.toFixed(2), plGlobal: +plGlobal.toFixed(2) },
    timestamp: new Date().toISOString()
  };
}

async function getData(force = false) {
  const stale = _cache && Date.now() - _cacheTs >= CACHE_TTL;

  // Return stale cache immediately and refresh in background
  if (!force && _cache && stale && !_building) {
    _building = true;
    buildData()
      .then(d => { _cache = d; _cacheTs = Date.now(); })
      .catch(e => console.error('BG refresh failed:', e.message))
      .finally(() => { _building = false; });
    return _cache;
  }

  if (!force && _cache && !stale) return _cache;

  // No cache yet or forced — wait for fresh data
  if (!_building) {
    _building = true;
    try {
      _cache = await buildData();
      _cacheTs = Date.now();
    } finally {
      _building = false;
    }
  } else {
    // Another build in progress — wait for it
    while (_building) await new Promise(r => setTimeout(r, 300));
  }
  return _cache;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/portfolio', async (req, res) => {
  try   { res.json(await getData()); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/refresh', async (req, res) => {
  try   { res.json(await getData(true)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`Portfolio Monitor v3.0  →  http://localhost:${PORT}`);
});

// HTTPS server for PWA standalone mode on mobile
const HTTPS_PORT = process.env.HTTPS_PORT || 4443;
try {
  const sslOpts = {
    key:  fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
  };
  https.createServer(sslOpts, app).listen(HTTPS_PORT, () => {
    console.log(`Portfolio Monitor v3.0  →  https://192.168.1.143:${HTTPS_PORT}  (móvil PWA)\n`);
    getData().catch(e => console.error('Pre-warm error:', e.message));
  });
} catch (e) {
  console.warn('HTTPS no disponible (cert.pem/key.pem no encontrados):', e.message);
  getData().catch(e2 => console.error('Pre-warm error:', e2.message));
}
