// ============================================================================
// PORTFOLIO PERSONAL — Posiciones reales con precios de entrada
// ============================================================================
// Capital total: 5,851.58 EUR | Disponible: 556.80 EUR | Invertido: 5,294.78 EUR
// 35 posiciones activas
// ============================================================================

const PORTFOLIO_PERSONAL = [
  // NÚCLEO — Posiciones grandes (>3%)
  { ticker: 'FIX',  empresa: 'Comfort Systems USA',   acciones: 0.141,  entrada: 1129.87 },
  { ticker: 'IESC', empresa: 'IES Holdings',          acciones: 0.3837, entrada: 448.56 },
  { ticker: 'CLS',  empresa: 'Celestica',             acciones: 0.6788, entrada: 301.20 },
  { ticker: 'MU',   empresa: 'Micron Technology',     acciones: 0.33,   entrada: 384.33 },
  { ticker: 'CRDO', empresa: 'Credo Technology',      acciones: 1.1153, entrada: 126.07 },
  { ticker: 'FN',   empresa: 'Fabrinet',              acciones: 0.3458, entrada: 531.98 },
  { ticker: 'CIEN', empresa: 'Ciena',                 acciones: 0.404,  entrada: 321.75 },
  { ticker: 'LITE', empresa: 'Lumentum',              acciones: 0.2491, entrada: 758.89 },
  { ticker: 'STX',  empresa: 'Seagate',               acciones: 0.2814, entrada: 471.51 },
  { ticker: 'SNDK', empresa: 'SanDisk',               acciones: 0.1539, entrada: 740.92 },
  { ticker: 'TER',  empresa: 'Teradyne',              acciones: 0.6307, entrada: 288.62 },
  { ticker: 'COHR', empresa: 'Coherent',              acciones: 0.5841, entrada: 216.72 },
  { ticker: 'ANET', empresa: 'Arista Networks',       acciones: 1.4271, entrada: 133.89 },
  { ticker: 'WDC',  empresa: 'Western Digital',       acciones: 0.4482, entrada: 285.83 },
  { ticker: 'FTAI', empresa: 'FTAI Aviation',         acciones: 0.8507, entrada: 240.35 },
  { ticker: 'VRT',  empresa: 'Vertiv',                acciones: 0.6457, entrada: 295.53 },
  { ticker: 'LRCX', empresa: 'Lam Research',          acciones: 0.6899, entrada: 217.52 },

  // MEDIO (2-3%)
  { ticker: 'GEV',  empresa: 'GE Vernova',            acciones: 0.1977, entrada: 848.01 },
  { ticker: 'KLAC', empresa: 'KLA Corporation',       acciones: 0.1052, entrada: 1584.71 },
  { ticker: 'GLW',  empresa: 'Corning',               acciones: 0.9908, entrada: 142.83 },
  { ticker: 'AMAT', empresa: 'Applied Materials',     acciones: 0.4268, entrada: 365.00 },
  { ticker: 'ORCL', empresa: 'Oracle',                acciones: 0.9598, entrada: 177.52 },
  { ticker: 'MKSI', empresa: 'MKS Instruments',       acciones: 0.5444, entrada: 244.69 },
  { ticker: 'HWM',  empresa: 'Howmet Aerospace',      acciones: 0.6311, entrada: 224.31 },
  { ticker: 'AMD',  empresa: 'Advanced Micro Devices',acciones: 0.3004, entrada: 428.44 },
  { ticker: 'DELL', empresa: 'Dell Technologies',     acciones: 0.4693, entrada: 236.73 },

  // PEQUEÑO (1-2%)
  { ticker: 'INTC', empresa: 'Intel',                 acciones: 1.1278, entrada: 114.06 },
  { ticker: 'MTZ',  empresa: 'MasTec',                acciones: 0.3451, entrada: 333.25 },
  { ticker: 'FLEX', empresa: 'Flex Ltd',              acciones: 0.5543, entrada: 131.65 },

  // MINI (<1%)
  { ticker: 'NXT',  empresa: 'Nextracker',            acciones: 0.4894, entrada: 129.85 },
  { ticker: 'NVMI', empresa: 'Nova',                  acciones: 0.126,  entrada: 504.17 },
  { ticker: 'STRL', empresa: 'Sterling Infrastructure',acciones: 0.0713, entrada: 753.05 },
  { ticker: 'AVGO', empresa: 'Broadcom',              acciones: 0.1203, entrada: 352.01 },
  { ticker: 'SITM', empresa: 'SiTime',                acciones: 0.0622, entrada: 733.18 },
  { ticker: 'TSEM', empresa: 'Tower Semiconductor',   acciones: 0.1442, entrada: 283.80 },

  // WATCHLIST — Sin posición abierta
  { ticker: 'APP',  empresa: 'Applovin Corporation', acciones: 0, entrada: 0 },
  { ticker: 'CVNA', empresa: 'Carvana',              acciones: 0, entrada: 0 }
];

const CAPITAL_DISPONIBLE_EUR = 556.80;

// Calcular % del portfolio basado en valor actual
function calcularPesosPortfolio(posiciones, preciosActuales) {
  // posiciones: array de PORTFOLIO_PERSONAL
  // preciosActuales: { 'FIX': 1563.38, ... }

  const valoresActuales = posiciones.map(p => ({
    ticker: p.ticker,
    valor: p.acciones * (preciosActuales[p.ticker] || p.entrada)
  }));

  const totalInvertido = valoresActuales.reduce((sum, v) => sum + v.valor, 0);

  return posiciones.map(p => {
    const valorActual = p.acciones * (preciosActuales[p.ticker] || p.entrada);
    const valorEntrada = p.acciones * p.entrada;
    const plPct = ((valorActual / valorEntrada) - 1) * 100;
    const pesoPct = (valorActual / totalInvertido) * 100;
    return {
      ...p,
      precioActual: preciosActuales[p.ticker] || null,
      valorActual: Math.round(valorActual * 100) / 100,
      valorEntrada: Math.round(valorEntrada * 100) / 100,
      plPct: Math.round(plPct * 100) / 100,
      pesoPct: Math.round(pesoPct * 100) / 100
    };
  });
}

module.exports = {
  PORTFOLIO_PERSONAL,
  CAPITAL_DISPONIBLE_EUR,
  calcularPesosPortfolio
};
