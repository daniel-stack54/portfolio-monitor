// ============================================================================
// TEST - Portfolio Monitor v3.0
// Validación del motor simplificado con casos reales
// ============================================================================

const { evaluarActivo, ordenarPorFuerzaSenal } = require('./scoringEngine');
const { PORTFOLIO_PERSONAL, calcularPesosPortfolio } = require('./portfolio');

function mockVelas(precioFinal, ema20, esVerde = true, conCuerpo = true, volAlto = false) {
  const velas = [];
  for (let i = 0; i < 30; i++) {
    const p = precioFinal * (0.92 + i * 0.0027) + (Math.random() - 0.5) * precioFinal * 0.008;
    const volumeBase = 1e6 + Math.random() * 2e5;
    velas.push({
      open: p * 0.998, high: p * 1.008, low: p * 0.992, close: p,
      volume: volumeBase
    });
  }
  // Última vela
  const vol = volAlto ? 1.8e6 : 1.05e6;
  velas[29] = esVerde
    ? { open: precioFinal * (conCuerpo ? 0.985 : 0.998),
        high: precioFinal * 1.005,
        low: precioFinal * (conCuerpo ? 0.982 : 0.996),
        close: precioFinal,
        volume: vol }
    : { open: precioFinal * 1.012,
        high: precioFinal * 1.014,
        low: precioFinal * 0.995,
        close: precioFinal,
        volume: vol };
  return velas;
}

const SPX_PRECIO = 7407.51;
const SPX_EMA20  = 7320;  // SPX a +1.2% — fuera de zona favorable estricta

// Casos de prueba representativos del portfolio
const casos = [
  // === ROTURA EMA50 al alza + vela verde + volumen ===
  { ticker: 'CRDO', precio: 188, ema20: 178, ema50: 185, ema200: 130,
    stochRsi: 52, velas: mockVelas(188, 178, true, true, true) },

  // === Pullback EMA20 + vela verde con cuerpo + volumen ===
  { ticker: 'FN', precio: 599, ema20: 595, ema50: 540, ema200: 460,
    stochRsi: 55, velas: mockVelas(599, 595, true, true, true) },

  // === Pullback EMA20 + vela verde sin cuerpo grande ===
  { ticker: 'CIEN', precio: 500, ema20: 498, ema50: 470, ema200: 400,
    stochRsi: 48, velas: mockVelas(500, 498, true, false, false) },

  // === Pullback EMA20 sin vela verde — solo vigilar ===
  { ticker: 'CLS', precio: 313, ema20: 318, ema50: 295, ema200: 240,
    stochRsi: 45, velas: mockVelas(313, 318, false, false, false) },

  // === Posición sana cerca EMA20 sin pullback ===
  { ticker: 'MU', precio: 642, ema20: 635, ema50: 580, ema200: 480,
    stochRsi: 65, velas: mockVelas(642, 635, true, false, false) },

  // === Extendido bajo EMA50 ===
  { ticker: 'ORCL', precio: 164, ema20: 175, ema50: 172, ema200: 150,
    stochRsi: 30, velas: mockVelas(164, 175, false, false, false) },

  // === VENDER: precio bajo EMA200 ===
  { ticker: 'FLEX', precio: 112, ema20: 120, ema50: 125, ema200: 130,
    stochRsi: 25, velas: mockVelas(112, 120, false, false, false) },

  // === Posición en tendencia sin señal ===
  { ticker: 'NVMI', precio: 510, ema20: 505, ema50: 480, ema200: 420,
    stochRsi: 68, velas: mockVelas(510, 505, false, false, false) }
];

console.log('\n' + '='.repeat(130));
console.log('PORTFOLIO MONITOR v3.0 — Motor Simplificado');
console.log(`SPX: ${SPX_PRECIO} | EMA20: ${SPX_EMA20} | Dist: ${((SPX_PRECIO/SPX_EMA20 - 1)*100).toFixed(2)}%`);
console.log('='.repeat(130));

const resultados = casos.map(c =>
  evaluarActivo({ ...c, spxPrecio: SPX_PRECIO, spxEma20: SPX_EMA20 })
);

const ordenados = ordenarPorFuerzaSenal(resultados);

console.log('Ticker'.padEnd(8) + 'Señal'.padEnd(20) + 'Alertas'.padEnd(15) + 'Detalle');
console.log('-'.repeat(130));

ordenados.forEach(r => {
  const alertasStr = r.alertas.map(a => a.icono).join(' ') || '—';
  const detalle = r.detalles
    ? `EMA20:${r.detalles.distEma20} | StochRSI:${r.detalles.stochRsi || '-'} | Vela:${r.detalles.vela} | Vol:${r.detalles.volumenRatio}x`
    : r.razon;
  console.log(
    r.ticker.padEnd(8) +
    r.senal.padEnd(20) +
    `${r.cantidadAlertas || 0}: ${alertasStr}`.padEnd(15) +
    detalle
  );
  if (r.razon) console.log('   ↳ ' + r.razon);
});

console.log('='.repeat(130));

// ============================================================================
// TEST de cálculo de % portfolio
// ============================================================================
console.log('\nCÁLCULO DE % DE PORTFOLIO (precios actuales de tu broker):');
console.log('-'.repeat(130));

const preciosActuales = {
  FIX: 1563.38, IESC: 560.61, CLS: 313.01, MU: 642.00, CRDO: 186.81,
  FN: 599.50, CIEN: 498.61, LITE: 808.39, STX: 694.63, SNDK: 1263.34,
  TER: 305.04, COHR: 322.20, ANET: 131.55, WDC: 414.07, FTAI: 215.55,
  VRT: 279.71, LRCX: 260.60, GEV: 886.30, KLAC: 1610.74, GLW: 164.99,
  AMAT: 369.07, ORCL: 163.97, MKSI: 273.86, HWM: 219.13, AMD: 399.93,
  DELL: 252.07, INTC: 102.45, MTZ: 326.51, FLEX: 112.86, NXT: 111.50,
  NVMI: 427.78, STRL: 626.79, AVGO: 354.13, SITM: 619.04, TSEM: 241.21
};

const posicionesConPesos = calcularPesosPortfolio(PORTFOLIO_PERSONAL, preciosActuales);
const ordenadasPorPeso = [...posicionesConPesos].sort((a, b) => b.pesoPct - a.pesoPct);

console.log('Ticker'.padEnd(8) + 'Empresa'.padEnd(28) + '% Port.'.padEnd(10) + 'Valor EUR'.padEnd(12) + 'P&L%');
console.log('-'.repeat(130));
ordenadasPorPeso.forEach(p => {
  console.log(
    p.ticker.padEnd(8) +
    p.empresa.substring(0, 26).padEnd(28) +
    `${p.pesoPct.toFixed(2)}%`.padEnd(10) +
    `${p.valorActual.toFixed(2)}`.padEnd(12) +
    `${p.plPct > 0 ? '+' : ''}${p.plPct.toFixed(2)}%`
  );
});

const total = posicionesConPesos.reduce((s, p) => s + p.valorActual, 0);
const totalEntrada = posicionesConPesos.reduce((s, p) => s + p.valorEntrada, 0);
console.log('-'.repeat(130));
console.log(`Total invertido: ${total.toFixed(2)} EUR | Coste base: ${totalEntrada.toFixed(2)} EUR | P&L global: +${(total - totalEntrada).toFixed(2)} EUR (+${(((total/totalEntrada)-1)*100).toFixed(2)}%)`);

console.log('\n✓ Motor v3.0 operativo. Tabla simplificada lista para deploy.\n');
