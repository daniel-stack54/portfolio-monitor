'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const mongoose   = require('mongoose');
const axios      = require('axios');
const path       = require('path');

const { evaluarActivo, ordenarPorFuerzaSenal, calcularRSCMansfield } = require('./scoringEngine');
const { PORTFOLIO_PERSONAL, calcularPesosPortfolio } = require('./portfolio');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'electron'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('manifest.json')) res.setHeader('Content-Type', 'application/manifest+json');
    if (filePath.endsWith('sw.js')) { res.setHeader('Service-Worker-Allowed', '/'); res.setHeader('Cache-Control', 'no-cache'); }
  }
}));

// ── MongoDB ────────────────────────────────────────────────────────────────────

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('[MongoDB] Conectado ✓');
  } catch (e) {
    console.error('[MongoDB] Error:', e.message);
    setTimeout(connectDB, 5000);
  }
}
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Desconectado — reintentando...');
  setTimeout(connectDB, 3000);
});

// ── Schemas ────────────────────────────────────────────────────────────────────

const stockSchema = new mongoose.Schema({
  symbol:        { type: String, required: true, unique: true, uppercase: true },
  empresa:       { type: String, default: '' },
  acciones:      { type: Number, default: 0 },
  precioEntrada: { type: Number, default: 0 },
  addedAt:       { type: Date,   default: Date.now }
});

const dataSchema = new mongoose.Schema({
  symbol:         { type: String, required: true, uppercase: true },
  precio:         Number,
  open:           Number,
  high:           Number,
  low:            Number,
  volume:         Number,
  hoyPct:         Number,   // % cambio vs apertura de hoy
  ema20:          Number,
  ema50:          Number,
  ema200:         Number,
  stochRsi:       Number,
  ema100:          Number,
  rsc:             { type: Number, default: null },
  rscSubiendo:     { type: Boolean, default: null },
  rscHace5:        { type: Number, default: null },
  senal:          { type: String, default: 'SIN_DATOS' },
  razon:          { type: String, default: '' },
  alertas:        { type: Array,  default: [] },
  cantidadAlertas:{ type: Number, default: 0 },
  earningsDate:   { type: String, default: null },
  earningsUrgency:{ type: String, default: 'NORMAL' },
  ratingMean:     { type: Number, default: null },
  ratingText:     { type: String, default: null },
  updatedAt:      { type: Date,   default: Date.now }
}, { collection: 'stockdata' });

const alertSchema = new mongoose.Schema({
  symbol:    String,
  tipo:      String,
  mensaje:   String,
  createdAt: { type: Date, default: Date.now }
});

const Stock     = mongoose.model('Stock',     stockSchema);
const StockData = mongoose.model('StockData', dataSchema);
const Alert     = mongoose.model('Alert',     alertSchema);

// ── Finnhub ────────────────────────────────────────────────────────────────────

const FH = axios.create({ baseURL: 'https://finnhub.io/api/v1', timeout: 10000 });

async function finnhubQuote(symbol) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await FH.get('/quote', { params: { symbol, token: process.env.FINNHUB_KEY } });
      return r.data;
    } catch (e) {
      if (i === 3) throw e;
      await sleep(i * 1500);
    }
  }
}

// ── Yahoo Finance ──────────────────────────────────────────────────────────────

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json'
};

const yahooMetaCache = new Map();
const newsCache      = new Map();

async function fetchCandles(symbol) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await axios.get(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
        { params: { range: '1y', interval: '1d' }, headers: YF_HEADERS, timeout: 14000 }
      );
      const result = res.data?.chart?.result?.[0];
      if (!result) throw new Error('Sin datos');
      const q  = result.indicators?.quote?.[0];
      const ts = result.timestamp || [];
      return ts.map((t, idx) => ({
        time:   t,
        open:   q.open?.[idx]   ?? null,
        high:   q.high?.[idx]   ?? null,
        low:    q.low?.[idx]    ?? null,
        close:  q.close?.[idx]  ?? null,
        volume: q.volume?.[idx] ?? 0
      })).filter(c => c.close != null);
    } catch (e) {
      if (i === 3) throw e;
      await sleep(i * 1500);
    }
  }
}

// ── Yahoo Finance metadata (earnings + rating, caché 24h) ─────────────────────

async function fetchYahooMeta(symbol) {
  const key    = symbol.toUpperCase();
  const cached = yahooMetaCache.get(key);
  if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) return cached.data;

  try {
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      { params: { modules: 'calendarEvents,financialData' }, headers: YF_HEADERS, timeout: 10000 }
    );
    const r = res.data?.quoteSummary?.result?.[0];
    if (!r) return null;

    // Earnings date
    let earningsDate = null, earningsUrgency = 'NORMAL';
    const dates = r.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(dates) && dates.length > 0) {
      const ts = (dates[0]?.raw || 0) * 1000;
      const daysUntil = (ts - Date.now()) / 86400000;
      if (daysUntil > 0 && daysUntil < 60) {
        earningsDate    = new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
        earningsUrgency = daysUntil < 3 ? 'URGENTE' : daysUntil < 7 ? 'PROXIMO' : 'NORMAL';
      }
    }

    // Analyst rating (1=Strong Buy … 5=Sell)
    const mean = r.financialData?.recommendationMean?.raw;
    let ratingText = null;
    if (mean != null) {
      if      (mean <= 1.5) ratingText = 'STRONG BUY';
      else if (mean <= 2.5) ratingText = 'BUY';
      else if (mean <= 3.5) ratingText = 'HOLD';
      else if (mean <= 4.5) ratingText = 'UNDERPERFORM';
      else                  ratingText = 'SELL';
    }

    const data = { earningsDate, earningsUrgency, ratingMean: mean || null, ratingText };
    yahooMetaCache.set(key, { ts: Date.now(), data });
    return data;
  } catch (e) {
    console.warn(`[${symbol}] Yahoo meta: ${e.message}`);
    return null;
  }
}

// ── Yahoo Finance news (caché 2h) ─────────────────────────────────────────────

async function fetchYahooNews(symbol) {
  const key    = symbol.toUpperCase();
  const cached = newsCache.get(key);
  if (cached && Date.now() - cached.ts < 2 * 3600 * 1000) return cached.data;

  try {
    const res = await axios.get(
      'https://query1.finance.yahoo.com/v1/finance/search',
      { params: { q: key, lang: 'en-US', region: 'US', quotesCount: 0, newsCount: 5 },
        headers: YF_HEADERS, timeout: 8000 }
    );
    const data = (res.data?.news || []).slice(0, 5).map(n => ({
      title: n.title, publisher: n.publisher, link: n.link, publishTime: n.providerPublishTime
    }));
    newsCache.set(key, { ts: Date.now(), data });
    return data;
  } catch (e) {
    console.warn(`[${key}] News: ${e.message}`);
    return [];
  }
}

// ── Indicadores ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return +ema.toFixed(4);
}

function calcRSISeries(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const rsi = [];
  let gSum = 0, lSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gSum += d; else lSum -= d;
  }
  let avgG = gSum / period, avgL = lSum / period;
  rsi.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    rsi.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  }
  return rsi;
}

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, smoothK = 3) {
  const rsiSeries = calcRSISeries(closes, rsiPeriod);
  if (rsiSeries.length < stochPeriod) return null;
  const raw = [];
  for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
    const win  = rsiSeries.slice(i - stochPeriod + 1, i + 1);
    const minR = Math.min(...win), maxR = Math.max(...win);
    raw.push(maxR === minR ? 0 : (rsiSeries[i] - minR) / (maxR - minR) * 100);
  }
  if (raw.length < smoothK) return null;
  const kValues = [];
  for (let i = smoothK - 1; i < raw.length; i++) {
    const win = raw.slice(i - smoothK + 1, i + 1);
    kValues.push(win.reduce((a, b) => a + b, 0) / smoothK);
  }
  return kValues.length ? +kValues[kValues.length - 1].toFixed(2) : null;
}

// ── Estado SPX ─────────────────────────────────────────────────────────────────

let spxState  = { precio: NaN, ema20: NaN, dist: NaN, estado: 'DESCONOCIDO' };
let spxVelas  = [];
let macroState = { semaforo: 'DESCONOCIDO', spx: {}, nyse: {}, nasdaq: {}, vix: {}, updatedAt: null };

const TECH_TICKERS = new Set([
  'CRDO','FN','CIEN','LITE','STX','SNDK','TER','COHR','ANET','WDC',
  'KLAC','AMAT','LRCX','AMD','INTC','MU','SITM','TSEM','ORCL','DELL',
  'AVGO','NVMI','MKSI','GLW','VRT','APP','NVDA','NVDA'
]);

async function updateSPX() {
  try {
    const velas = await fetchCandles('SPY');
    if (!velas.length) return;
    const closes = velas.map(c => c.close);
    const precio = closes[closes.length - 1];
    const ema20  = calcEMA(closes, 20);
    const dist   = ema20 ? ((precio - ema20) / ema20) * 100 : NaN;
    let estado = 'DESCONOCIDO';
    if (isFinite(dist)) {
      if (dist >= -2 && dist <= 1)        estado = 'FAVORABLE';
      else if (dist > 1 && dist <= 2.5)   estado = 'EXTENDIDO_LEVE';
      else if (dist < -2 && dist >= -4)   estado = 'CORRECCION_LEVE';
      else if (dist > 2.5)                estado = 'EXTENDIDO';
      else                                estado = 'CORRECCION_FUERTE';
    }
    spxVelas  = velas;   // guardamos para RSC Mansfield
    spxState  = { precio, ema20, dist, estado };
    console.log(`[SPX] SPY=${precio?.toFixed(2)} EMA20=${ema20?.toFixed(2)} dist=${dist?.toFixed(2)}% → ${estado}`);
  } catch (e) {
    console.warn('[SPX] Error:', e.message);
  }
}

// ── Panel Macro ────────────────────────────────────────────────────────────────

async function updateMacro() {
  try {
    const [velasNYA, velasNDX, velasVIX] = await Promise.all([
      fetchCandles('^NYA').catch(() => []),
      fetchCandles('^IXIC').catch(() => []),
      fetchCandles('^VIX').catch(() => [])
    ]);

    // SPX vs EMA150 (usa spxVelas ya cargadas)
    const spxCloses = spxVelas.map(v => v.close);
    const spxEma150 = spxCloses.length >= 150 ? calcEMA(spxCloses, 150) : null;
    const spxP      = spxCloses.length ? spxCloses[spxCloses.length - 1] : null;
    const spxD150   = spxP && spxEma150 ? (spxP - spxEma150) / spxEma150 * 100 : null;
    const spxEncima = spxD150 !== null && spxD150 > 0;

    // NYSE vs EMA200
    const nyaC    = velasNYA.map(v => v.close);
    const nyaEma  = nyaC.length >= 200 ? calcEMA(nyaC, 200) : null;
    const nyaP    = nyaC.length ? nyaC[nyaC.length - 1] : null;
    const nyaD    = nyaP && nyaEma ? (nyaP - nyaEma) / nyaEma * 100 : null;
    const nyaEnc  = nyaP && nyaEma ? nyaP > nyaEma : false;

    // Nasdaq vs EMA50
    const ndxC    = velasNDX.map(v => v.close);
    const ndxEma  = ndxC.length >= 50  ? calcEMA(ndxC, 50)  : null;
    const ndxP    = ndxC.length ? ndxC[ndxC.length - 1] : null;
    const ndxD    = ndxP && ndxEma ? (ndxP - ndxEma) / ndxEma * 100 : null;
    const ndxDebil = ndxP && ndxEma ? ndxP < ndxEma : false;

    // VIX
    const vixC    = velasVIX.map(v => v.close);
    const vixP    = vixC.length ? vixC[vixC.length - 1] : null;
    const vixEst  = vixP == null ? 'DESCONOCIDO'
                  : vixP < 15   ? 'COMPLACENCIA'
                  : vixP < 20   ? 'NORMAL'
                  : vixP < 30   ? 'MIEDO'
                  : 'PANICO';

    // Semáforo global
    let semaforo = 'AMARILLO';
    if (spxEncima && nyaEnc && vixP !== null && vixP < 20)          semaforo = 'VERDE';
    else if (!spxEncima || (vixP !== null && vixP > 30))            semaforo = 'ROJO';

    macroState = {
      semaforo,
      spx:    { precio: spxP,  ema150: spxEma150, dist: spxD150, encima: spxEncima },
      nyse:   { precio: nyaP,  ema200: nyaEma,    dist: nyaD,   encima: nyaEnc },
      nasdaq: { precio: ndxP,  ema50:  ndxEma,    dist: ndxD,   debil:  ndxDebil },
      vix:    { valor:  vixP,  estado: vixEst },
      updatedAt: new Date()
    };
    console.log(`[MACRO] ${semaforo} | VIX=${vixP?.toFixed(1)||'N/D'} ${vixEst} | NYSE ${nyaEnc?'▲':'▼'} EMA200 | NDX ${ndxDebil?'DÉBIL':'OK'}`);
  } catch (e) {
    console.error('[MACRO] Error:', e.message);
  }
}

// ── Fetch + calcular un símbolo ────────────────────────────────────────────────

async function fetchAndCalc(symbol) {
  const [velas, quote, meta] = await Promise.all([
    fetchCandles(symbol),
    finnhubQuote(symbol),
    fetchYahooMeta(symbol).catch(() => null)
  ]);
  if (!velas.length) throw new Error(`Sin velas para ${symbol}`);

  const closes = velas.map(c => c.close);

  // Precio real de Finnhub sobre la última vela
  const precio = (quote?.c && quote.c > 0) ? quote.c : closes[closes.length - 1];
  const last   = { ...velas[velas.length - 1] };
  last.close   = precio;
  if (quote?.o && quote.o > 0) last.open = quote.o;
  if (quote?.h && quote.h > 0) last.high = quote.h;
  if (quote?.l && quote.l > 0) last.low  = quote.l;

  const velasActualizadas = [...velas.slice(0, -1), last];
  const closesAct = velasActualizadas.map(c => c.close);

  const ema20    = calcEMA(closesAct, 20);
  const ema50    = calcEMA(closesAct, 50);
  const ema100   = calcEMA(closesAct, 100);
  const ema200   = calcEMA(closesAct, 200);
  const stochRsi = calcStochRSI(closesAct);
  const hoyPct   = last.open > 0 ? +((precio - last.open) / last.open * 100).toFixed(2) : 0;

  // RSC Mansfield — alinear precios por longitud
  const spxClosesAligned = spxVelas.slice(-closesAct.length).map(c => c.close);
  const rscData = calcularRSCMansfield(closesAct, spxClosesAligned);

  const resultado = evaluarActivo({
    ticker:   symbol,
    precio,
    ema20, ema50, ema100, ema200,
    stochRsi,
    velas:    velasActualizadas,
    spxPrecio:   spxState.precio,
    spxEma20:    spxState.ema20,
    rsc:         rscData,
    macroEstado: macroState.semaforo,
    nasdaqDebil: macroState.nasdaq?.debil || false,
    isTech:      TECH_TICKERS.has(symbol)
  });

  return {
    symbol,
    precio,
    open:   last.open,
    high:   last.high,
    low:    last.low,
    volume: last.volume,
    hoyPct,
    ema20, ema50, ema100, ema200,
    stochRsi,
    rsc:         rscData?.valor    ?? null,
    rscSubiendo: rscData?.subiendo ?? null,
    rscHace5:    rscData?.hace5    ?? null,
    senal:          resultado.senal,
    razon:          resultado.razon || '',
    alertas:        resultado.alertas || [],
    cantidadAlertas:resultado.cantidadAlertas || 0,
    earningsDate:    meta?.earningsDate    || null,
    earningsUrgency: meta?.earningsUrgency || 'NORMAL',
    ratingMean:      meta?.ratingMean      || null,
    ratingText:      meta?.ratingText      || null,
    updatedAt: new Date()
  };
}

// ── Ciclo de actualización ─────────────────────────────────────────────────────

let _updating = false;

async function updateAll() {
  if (_updating) return;
  _updating = true;
  try {
    await updateSPX();
    await updateMacro();
    const stocks = await Stock.find();
    for (const s of stocks) {
      try {
        const datos = await fetchAndCalc(s.symbol);
        await StockData.findOneAndUpdate(
          { symbol: s.symbol },
          datos,
          { upsert: true, returnDocument: 'after' }
        );
        // Alerta si señal de compra nueva
        if (datos.senal === 'COMPRA_FUERTE' || datos.senal === 'COMPRA') {
          const hace1h = new Date(Date.now() - 3600_000);
          const reciente = await Alert.findOne({ symbol: s.symbol, tipo: datos.senal, createdAt: { $gt: hace1h } });
          if (!reciente) {
            await Alert.create({ symbol: s.symbol, tipo: datos.senal, mensaje: datos.razon });
          }
        }
        const icons = datos.alertas.map(a => a.icono).join(' ') || '—';
        console.log(`[${s.symbol}] ${datos.senal} | ${icons} | StochRSI=${datos.stochRsi}`);
      } catch (e) {
        console.error(`[${s.symbol}] Error:`, e.message);
      }
      await sleep(900);
    }
  } finally {
    _updating = false;
  }
}

// ── Seed portfolio real ────────────────────────────────────────────────────────

async function seedPortfolio() {
  for (const p of PORTFOLIO_PERSONAL) {
    await Stock.findOneAndUpdate(
      { symbol: p.ticker },
      { symbol: p.ticker, empresa: p.empresa, acciones: p.acciones, precioEntrada: p.entrada },
      { upsert: true }
    );
  }
  console.log(`[Seed] ${PORTFOLIO_PERSONAL.length} acciones en DB`);
}

// ── API REST ───────────────────────────────────────────────────────────────────

app.get('/portfolio', async (req, res) => {
  try {
    const stocks = await Stock.find().lean();
    const data   = await StockData.find().lean();
    const map    = Object.fromEntries(data.map(d => [d.symbol, d]));

    // Calcular % portfolio dinámicamente con precios actuales
    const preciosActuales = Object.fromEntries(
      data.filter(d => d.precio).map(d => [d.symbol, d.precio])
    );
    const pesosMap = {};
    const totalValor = stocks.reduce((sum, s) => {
      const precio  = preciosActuales[s.symbol] || s.precioEntrada;
      return sum + s.acciones * precio;
    }, 0);
    for (const s of stocks) {
      const precio = preciosActuales[s.symbol] || s.precioEntrada;
      pesosMap[s.symbol] = totalValor > 0
        ? +((s.acciones * precio / totalValor) * 100).toFixed(2)
        : 0;
    }

    // Ranking RSC (mayor RSC = mejor fuerza relativa = rank #1)
    const rscRanking = data
      .filter(d => d.rsc !== null && d.rsc !== undefined)
      .sort((a, b) => (b.rsc || -999) - (a.rsc || -999));
    const rankMap = {};
    rscRanking.forEach((d, i) => { rankMap[d.symbol] = i + 1; });

    const result = stocks.map(s => {
      const d       = map[s.symbol] || {};
      const rscRank = rankMap[s.symbol] || null;

      // Boost top 10 + RSC subiendo: COMPRA → COMPRA_FUERTE
      let senal = d.senal || 'SIN_DATOS';
      if (senal === 'COMPRA' && rscRank && rscRank <= 10 && d.rscSubiendo) {
        senal = 'COMPRA_FUERTE';
      }

      return {
        symbol:        s.symbol,
        empresa:       s.empresa,
        acciones:      s.acciones,
        precioEntrada: s.precioEntrada,
        pesoPct:       pesosMap[s.symbol] || 0,
        ...d,
        senal,
        rscRank
      };
    });

    // Ordenar por fuerza de señal
    const ORDEN = { COMPRA_FUERTE:1, COMPRA:2, COMPRA_PARCIAL:3, VIGILAR_PULLBACK:4, VIGILAR_REBOTE:5, MANTENER:6, VENDER:7, SIN_DATOS:8 };
    result.sort((a, b) => {
      const pa = ORDEN[a.senal] || 9, pb = ORDEN[b.senal] || 9;
      return pa !== pb ? pa - pb : (b.cantidadAlertas || 0) - (a.cantidadAlertas || 0);
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/spx',   (req, res) => res.json(spxState));
app.get('/macro', (req, res) => res.json(macroState));

app.get('/alerts', async (req, res) => {
  try {
    res.json(await Alert.find().sort({ createdAt: -1 }).limit(50).lean());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/add-stock', async (req, res) => {
  try {
    const { symbol, empresa = '', acciones = 0, precioEntrada = 0 } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Falta símbolo' });
    const sym = symbol.toUpperCase();
    await Stock.findOneAndUpdate(
      { symbol: sym },
      { symbol: sym, empresa, acciones: +acciones, precioEntrada: +precioEntrada },
      { upsert: true }
    );
    try {
      const datos = await fetchAndCalc(sym);
      await StockData.findOneAndUpdate({ symbol: sym }, datos, { upsert: true });
    } catch { /* se actualiza en próximo ciclo */ }
    res.json({ ok: true, symbol: sym });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/remove-stock/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    await Stock.deleteOne({ symbol: sym });
    await StockData.deleteOne({ symbol: sym });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/candles/:symbol', async (req, res) => {
  try {
    const all = await fetchCandles(req.params.symbol.toUpperCase());
    res.json(all.slice(-90));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/news/:symbol', async (req, res) => {
  try {
    res.json(await fetchYahooNews(req.params.symbol.toUpperCase()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/ping', (req, res) => res.send('ok'));

// ── Arranque ───────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\nPortfolio Monitor → http://localhost:${PORT}`);
  await connectDB();
  await seedPortfolio();
  await updateAll();
  setInterval(updateAll, 30_000);
});
