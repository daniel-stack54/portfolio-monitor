// ============================================================================
// PORTFOLIO MONITOR - MOTOR DE SEÑALES v3.1
// ============================================================================
// SEÑALES: COMPRA_FUERTE > COMPRA > COMPRA_PARCIAL > VIGILAR_PULLBACK >
//          VIGILAR_REBOTE > MANTENER > VENDER
// ZONAS:   EMA20 (-5% a +2%), EMA50 (±3%), EMA100 (±3%)
// PATRONES: Hammer, Bullish Engulfing, Three White Soldiers, Morning Star,
//           Piercing Line — detectado sube señal un nivel
// ============================================================================

const pct = (a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a - b) / b) * 100;
};

const isValidNumber = (v) => Number.isFinite(v) && v > 0;

// ============================================================================
// VELA VERDE Y SU FUERZA
// ============================================================================

function evaluarVela(velaActual) {
  if (!velaActual) return { esVerde: false, conCuerpo: false, ratio: 0 };
  const open  = velaActual.open  || 0;
  const close = velaActual.close || 0;
  const high  = velaActual.high  || 0;
  const low   = velaActual.low   || 0;

  const esVerde = close > open;
  const rango   = high - low;
  const cuerpo  = Math.abs(close - open);
  const ratio   = rango > 0 ? cuerpo / rango : 0;

  return { esVerde, conCuerpo: esVerde && ratio > 0.5, ratio };
}

// ============================================================================
// VOLUMEN SUPERIOR
// ============================================================================

function evaluarVolumen(velaActual, velasRecientes) {
  if (!velaActual || !Array.isArray(velasRecientes) || velasRecientes.length < 10) {
    return { superior: false, ratio: 1 };
  }
  const volActual = velaActual.volume || 0;
  const ultimas10 = velasRecientes.slice(-11, -1);
  const promedio  = ultimas10.reduce((s, v) => s + (v.volume || 0), 0) / ultimas10.length;
  const ratio     = promedio > 0 ? volActual / promedio : 1;

  return {
    superior: ratio >= 1.2,
    muyAlto:  ratio >= 1.5,
    ratio:    Math.round(ratio * 100) / 100
  };
}

// ============================================================================
// ZONAS DE PULLBACK
// ============================================================================

// EMA20: zona ampliada -5% a +2%
function detectarPullbackEMA20(precio, ema20, velas) {
  if (!isValidNumber(precio) || !isValidNumber(ema20)) {
    return { enZona: false, distancia: null };
  }
  const dist   = pct(precio, ema20);
  const enZona = dist >= -5 && dist <= 2;

  let vieneDePullback = false;
  if (Array.isArray(velas) && velas.length >= 5) {
    const max5 = Math.max(...velas.slice(-5).map(v => v.high || 0));
    vieneDePullback = pct(precio, max5) < -1;
  }

  return { enZona, distancia: dist, vieneDePullback };
}

// EMA50: zona ±3%
function detectarPullbackEMA50(precio, ema50) {
  if (!isValidNumber(precio) || !isValidNumber(ema50)) {
    return { enZona: false, distancia: null };
  }
  const dist = pct(precio, ema50);
  return { enZona: dist >= -3 && dist <= 3, distancia: dist };
}

// EMA100: zona ±3%
function detectarPullbackEMA100(precio, ema100) {
  if (!isValidNumber(precio) || !isValidNumber(ema100)) {
    return { enZona: false, distancia: null };
  }
  const dist = pct(precio, ema100);
  return { enZona: dist >= -3 && dist <= 3, distancia: dist };
}

// ============================================================================
// EXTENSIÓN BAJO EMA50 (rebote)
// ============================================================================

function detectarExtensionEMA50(precio, ema50) {
  if (!isValidNumber(precio) || !isValidNumber(ema50)) {
    return { extendido: false, distancia: null };
  }
  const dist = pct(precio, ema50);
  return { extendido: dist <= -3, distancia: dist };
}

// ============================================================================
// ROTURA AL ALZA DE EMA50
// ============================================================================

function detectarRoturaEMA50(precio, ema50, velas) {
  if (!isValidNumber(precio) || !isValidNumber(ema50) ||
      !Array.isArray(velas) || velas.length < 3) {
    return { rotura: false };
  }
  const curr = velas[velas.length - 1];
  const ant1 = velas[velas.length - 2];
  const ant2 = velas[velas.length - 3];
  if (!curr || !ant1) return { rotura: false };

  const c0 = curr.close || 0, c1 = ant1.close || 0, c2 = ant2 ? (ant2.close || 0) : c1;
  const rotura = (c1 < ema50 || c2 < ema50) && c0 > ema50;
  return { rotura, cierreActual: c0, ema50 };
}

// ============================================================================
// STOCH RSI ZONA FAVORABLE (40-75)
// ============================================================================

function evaluarStochRSI(stochRsi) {
  if (!Number.isFinite(stochRsi)) return { enZona: false, valor: null };
  return { enZona: stochRsi >= 40 && stochRsi <= 75, valor: stochRsi };
}

// ============================================================================
// ESTADO SPX
// ============================================================================

function evaluarSPX(spxPrecio, spxEma20) {
  if (!isValidNumber(spxPrecio) || !isValidNumber(spxEma20)) {
    return { favorable: false, distancia: null, estado: 'DESCONOCIDO' };
  }
  const dist = pct(spxPrecio, spxEma20);

  if (dist >= -2 && dist <= 1)      return { favorable: true,  distancia: dist, estado: 'FAVORABLE' };
  if (dist >  1  && dist <= 2.5)    return { favorable: false, distancia: dist, estado: 'EXTENDIDO_LEVE' };
  if (dist < -2  && dist >= -4)     return { favorable: false, distancia: dist, estado: 'CORRECCION_LEVE' };
  return { favorable: false, distancia: dist, estado: dist > 0 ? 'EXTENDIDO' : 'CORRECCION_FUERTE' };
}

// ============================================================================
// PATRONES DE VELAS JAPONESAS
// ============================================================================

function esHammer(velas) {
  const v = velas[velas.length - 1];
  if (!v) return false;
  const body      = Math.abs(v.close - v.open);
  const range     = v.high - v.low;
  const lowerWick = Math.min(v.open, v.close) - v.low;
  const upperWick = v.high - Math.max(v.open, v.close);
  return range > 0 &&
         body / range < 0.35 &&
         lowerWick >= 2 * body &&
         upperWick / range < 0.2;
}

function esBullishEngulfing(velas) {
  if (velas.length < 2) return false;
  const prev = velas[velas.length - 2];
  const curr = velas[velas.length - 1];
  return prev.open > prev.close &&
         curr.close > curr.open &&
         curr.open  <= prev.close &&
         curr.close >= prev.open;
}

function esThreeWhiteSoldiers(velas) {
  if (velas.length < 3) return false;
  const v1 = velas[velas.length - 3];
  const v2 = velas[velas.length - 2];
  const v3 = velas[velas.length - 1];
  return v1.close > v1.open && v2.close > v2.open && v3.close > v3.open &&
         v2.close > v1.close && v3.close > v2.close &&
         v2.open  >= v1.open && v3.open  >= v2.open;
}

function esMorningStar(velas) {
  if (velas.length < 3) return false;
  const v1 = velas[velas.length - 3];
  const v2 = velas[velas.length - 2];
  const v3 = velas[velas.length - 1];
  const body1 = Math.abs(v1.close - v1.open);
  const body2 = Math.abs(v2.close - v2.open);
  const midV1 = (v1.open + v1.close) / 2;
  return v1.open   > v1.close &&
         body2     < body1 * 0.5 &&
         v3.close  > v3.open &&
         Math.abs(v3.close - v3.open) > body2 &&
         v3.close  > midV1;
}

function esPiercingLine(velas) {
  if (velas.length < 2) return false;
  const prev    = velas[velas.length - 2];
  const curr    = velas[velas.length - 1];
  const midPrev = (prev.open + prev.close) / 2;
  return prev.open  > prev.close &&
         curr.close > curr.open  &&
         curr.open  < prev.low   &&
         curr.close > midPrev    &&
         curr.close < prev.open;
}

function detectarPatronesVela(velas) {
  if (!Array.isArray(velas) || velas.length < 1) return null;
  if (velas.length >= 3 && esThreeWhiteSoldiers(velas))
    return { patron: 'THREE_WHITE_SOLDIERS', icono: '🕯️', nombre: 'Tres Soldados' };
  if (velas.length >= 3 && esMorningStar(velas))
    return { patron: 'MORNING_STAR', icono: '🌟', nombre: 'Estrella Matutina' };
  if (velas.length >= 2 && esBullishEngulfing(velas))
    return { patron: 'BULLISH_ENGULFING', icono: '🕯️', nombre: 'Envolvente Alcista' };
  if (velas.length >= 2 && esPiercingLine(velas))
    return { patron: 'PIERCING_LINE', icono: '🕯️', nombre: 'Línea Penetración' };
  if (esHammer(velas))
    return { patron: 'HAMMER', icono: '🔨', nombre: 'Martillo' };
  return null;
}

// Sube la señal un nivel cuando hay patrón de vela confirmado
function subirSenal(senal) {
  const upgrade = {
    'MANTENER':         'VIGILAR_PULLBACK',
    'VIGILAR_PULLBACK': 'COMPRA_PARCIAL',
    'VIGILAR_REBOTE':   'COMPRA_PARCIAL',
    'COMPRA_PARCIAL':   'COMPRA',
    'COMPRA':           'COMPRA_FUERTE',
  };
  return upgrade[senal] || senal;
}

// ============================================================================
// RSC MANSFIELD — Fuerza Relativa de Stan Weinstein
// ============================================================================
// RP[i] = (precio_accion[i] / precio_SPX[i]) * 100
// SMA_RP = media simple de los últimos 200 RP
// RSC    = ((RP_hoy / SMA_RP) - 1) * 100

function calcularRSCMansfield(preciosAccion, preciosSPX) {
  const n = Math.min(preciosAccion.length, preciosSPX.length);
  if (n < 200) return null;

  const rp = [];
  for (let i = n - 200; i < n; i++) {
    if (!preciosSPX[i] || preciosSPX[i] <= 0) return null;
    rp.push((preciosAccion[i] / preciosSPX[i]) * 100);
  }

  const smaRP = rp.reduce((a, b) => a + b, 0) / 200;
  if (!smaRP) return null;

  const rscHoy = ((rp[199] / smaRP) - 1) * 100;
  const rsc5   = rp.length >= 6 ? ((rp[194] / smaRP) - 1) * 100 : null;

  return {
    valor:           +rscHoy.toFixed(2),
    subiendo:        rsc5 !== null ? rscHoy > rsc5 : null,
    hace5:           rsc5 !== null ? +rsc5.toFixed(2) : null,
    perdioLiderazgo: rsc5 !== null && rscHoy < 0 && rsc5 > 0
  };
}

// ============================================================================
// FUNCIÓN PRINCIPAL — EVALUAR ACTIVO
// ============================================================================

function evaluarActivo(datos) {
  if (!isValidNumber(datos.precio) || !isValidNumber(datos.ema20) ||
      !isValidNumber(datos.ema50)  || !isValidNumber(datos.ema200)) {
    return { ticker: datos.ticker || 'DESCONOCIDO', senal: 'SIN_DATOS', alertas: [], detalles: null };
  }

  // ====== VETO EMA200 ======
  if (datos.precio < datos.ema200) {
    return {
      ticker: datos.ticker, senal: 'VENDER',
      razon: 'Precio bajo EMA200 — fuera de tendencia', alertas: [],
      detalles: { precio: datos.precio, ema200: datos.ema200, distEma200: pct(datos.precio, datos.ema200).toFixed(2) + '%' }
    };
  }

  // ====== RSC / MACRO ======
  const rsc         = datos.rsc   || null;
  const rscPositivo = rsc !== null && rsc.valor > 0;
  const rscSubiendo = rsc !== null && rsc.subiendo === true;
  const macroRojo   = datos.macroEstado === 'ROJO';
  const nasdaqPena  = datos.nasdaqDebil === true && datos.isTech === true;

  // ====== DETECCIONES ======
  const pullback    = detectarPullbackEMA20(datos.precio, datos.ema20, datos.velas);
  const pullback50  = detectarPullbackEMA50(datos.precio, datos.ema50);
  const pullback100 = datos.ema100
    ? detectarPullbackEMA100(datos.precio, datos.ema100)
    : { enZona: false, distancia: null };
  const extension50 = detectarExtensionEMA50(datos.precio, datos.ema50);
  const rotura50    = detectarRoturaEMA50(datos.precio, datos.ema50, datos.velas);
  const vela        = evaluarVela(datos.velas?.[datos.velas.length - 1]);
  const volumen     = evaluarVolumen(datos.velas?.[datos.velas.length - 1], datos.velas);
  const stochRsi    = evaluarStochRSI(datos.stochRsi);
  const spx         = evaluarSPX(datos.spxPrecio, datos.spxEma20);
  const patron      = detectarPatronesVela(datos.velas);

  // ====== ALERTAS ======
  const alertas = [];
  if (pullback.enZona)  alertas.push({ icono: '🎯', tipo: 'PULLBACK_EMA20', mensaje: `Zona EMA20 (${pullback.distancia.toFixed(2)}%)` });
  if (stochRsi.enZona)  alertas.push({ icono: '📊', tipo: 'STOCH_RSI',      mensaje: `StochRSI ${stochRsi.valor.toFixed(1)}` });
  if (spx.favorable)    alertas.push({ icono: '📈', tipo: 'SPX_FAVORABLE',  mensaje: `SPX favorable (${spx.distancia.toFixed(2)}%)` });
  if (vela.esVerde)     alertas.push({ icono: vela.conCuerpo ? '🟢' : '🟩', tipo: vela.conCuerpo ? 'VELA_VERDE_FUERTE' : 'VELA_VERDE', mensaje: vela.conCuerpo ? 'Vela verde con cuerpo' : 'Vela verde' });
  if (volumen.superior) alertas.push({ icono: volumen.muyAlto ? '🔊' : '🔉', tipo: volumen.muyAlto ? 'VOLUMEN_ALTO' : 'VOLUMEN_SUPERIOR', mensaje: `Volumen ${volumen.ratio}x` });
  if (patron)           alertas.push({ icono: patron.icono, tipo: patron.patron, mensaje: patron.nombre });
  if (rscSubiendo)      alertas.push({ icono: '💪', tipo: 'RSC_SUBIENDO', mensaje: `RSC ${rsc.valor.toFixed(2)} subiendo` });

  // ====== SEÑAL BASE ======
  let senal = 'MANTENER';
  let razon = '';

  if (rotura50.rotura && vela.esVerde) {
    if (vela.conCuerpo && volumen.superior) { senal = 'COMPRA_FUERTE'; razon = 'Rotura EMA50 + vela cuerpo + volumen'; }
    else if (vela.conCuerpo)               { senal = 'COMPRA';        razon = 'Rotura EMA50 + vela con cuerpo'; }
    else if (volumen.superior)             { senal = 'COMPRA';        razon = 'Rotura EMA50 + vela + volumen'; }
    else                                   { senal = 'COMPRA_PARCIAL'; razon = 'Rotura EMA50 + vela verde'; }
  } else if (pullback.enZona && vela.esVerde) {
    if (vela.conCuerpo && volumen.superior) { senal = 'COMPRA_FUERTE'; razon = 'Pullback EMA20 + vela cuerpo + volumen'; }
    else if (vela.conCuerpo)               { senal = 'COMPRA';        razon = 'Pullback EMA20 + vela con cuerpo'; }
    else if (volumen.superior)             { senal = 'COMPRA';        razon = 'Pullback EMA20 + vela + volumen'; }
    else                                   { senal = 'COMPRA_PARCIAL'; razon = 'Pullback EMA20 + vela verde'; }
  } else if (pullback50.enZona && vela.esVerde) {
    if (vela.conCuerpo && volumen.superior) { senal = 'COMPRA';        razon = 'Pullback EMA50 + vela cuerpo + volumen'; }
    else                                    { senal = 'COMPRA_PARCIAL'; razon = 'Pullback EMA50 + vela verde'; }
  } else if (pullback100.enZona && vela.esVerde) {
    senal = 'COMPRA_PARCIAL'; razon = 'Pullback EMA100 + vela verde';
  } else if (pullback.enZona && pullback.vieneDePullback) {
    senal = 'VIGILAR_PULLBACK'; razon = `Zona EMA20 (${pullback.distancia.toFixed(2)}%), esperar vela`;
  } else if (pullback50.enZona) {
    senal = 'VIGILAR_PULLBACK'; razon = `Zona EMA50 (${pullback50.distancia.toFixed(2)}%), esperar vela`;
  } else if (extension50.extendido) {
    senal = 'VIGILAR_REBOTE'; razon = `${extension50.distancia.toFixed(2)}% bajo EMA50, esperar rebote`;
  } else {
    senal = 'MANTENER'; razon = 'En tendencia, sin pullback ni rotura';
  }

  // ====== UPGRADE POR PATRÓN (solo si RSC > 0 o RSC no disponible) ======
  if (patron && (rscPositivo || rsc === null)) {
    const prev = senal;
    senal = subirSenal(senal);
    if (senal !== prev) razon = `${patron.nombre} → ${razon}`;
  }

  // ====== FILTRO RSC — cap buys si RSC ≤ 0 ======
  const COMPRAS = ['COMPRA_FUERTE', 'COMPRA', 'COMPRA_PARCIAL'];
  if (rsc !== null && !rscPositivo) {
    if (COMPRAS.includes(senal)) {
      senal = 'MANTENER';
      razon = `RSC ${rsc.valor.toFixed(2)} — sin liderazgo vs mercado`;
    } else if (senal === 'VIGILAR_PULLBACK') {
      senal = 'MANTENER';
      razon = `RSC ${rsc.valor.toFixed(2)} — pullback sin atractivo`;
    }
  }

  // ====== AJUSTE MACRO ROJO ======
  if (macroRojo && COMPRAS.includes(senal)) {
    const prev = senal;
    if (senal === 'COMPRA_FUERTE')  senal = 'COMPRA';
    else if (senal === 'COMPRA')    senal = 'COMPRA_PARCIAL';
    else                            senal = 'VIGILAR_PULLBACK';
    if (senal !== prev) razon = '🔴 Macro ROJO → ' + razon;
  }

  // ====== AJUSTE NASDAQ DÉBIL + TECH ======
  if (nasdaqPena && COMPRAS.includes(senal)) {
    const prev = senal;
    if (senal === 'COMPRA_FUERTE')  senal = 'COMPRA';
    else if (senal === 'COMPRA')    senal = 'COMPRA_PARCIAL';
    else                            senal = 'VIGILAR_PULLBACK';
    if (senal !== prev) razon = '📉 Nasdaq débil → ' + razon;
  }

  // ====== RSC PERDIÓ LIDERAZGO ======
  if (rsc?.perdioLiderazgo) {
    razon = '⚠️ PIERDE LIDERAZGO → ' + razon;
  }

  return {
    ticker: datos.ticker, senal, razon, alertas,
    cantidadAlertas: alertas.length,
    detalles: {
      precio:      datos.precio,
      distEma20:   pullback.distancia    !== null ? pullback.distancia.toFixed(2)    + '%' : 'N/D',
      distEma50:   extension50.distancia !== null ? extension50.distancia.toFixed(2) + '%' : 'N/D',
      distEma100:  pullback100.distancia !== null ? pullback100.distancia.toFixed(2) + '%' : 'N/D',
      distEma200:  pct(datos.precio, datos.ema200).toFixed(2) + '%',
      stochRsi:    stochRsi.valor,
      vela:        vela.esVerde ? (vela.conCuerpo ? 'VERDE_CUERPO' : 'VERDE') : 'ROJA',
      volumenRatio: volumen.ratio,
      spxEstado:   spx.estado,
      spxDist:     spx.distancia !== null ? spx.distancia.toFixed(2) + '%' : 'N/D',
      patron:      patron ? patron.patron : null,
      rsc:         rsc?.valor ?? null,
      rscSubiendo: rsc?.subiendo ?? null,
      macroEstado: datos.macroEstado || null
    }
  };
}

// ============================================================================
// ORDENAR POR FUERZA DE SEÑAL
// ============================================================================

const PRIORIDAD_SENAL = {
  'COMPRA_FUERTE':    1,
  'COMPRA':           2,
  'COMPRA_PARCIAL':   3,
  'VIGILAR_PULLBACK': 4,
  'VIGILAR_REBOTE':   5,
  'MANTENER':         6,
  'VENDER':           7,
  'SIN_DATOS':        8
};

function ordenarPorFuerzaSenal(resultados) {
  return resultados.sort((a, b) => {
    const pA = PRIORIDAD_SENAL[a.senal] || 99;
    const pB = PRIORIDAD_SENAL[b.senal] || 99;
    if (pA !== pB) return pA - pB;
    return (b.cantidadAlertas || 0) - (a.cantidadAlertas || 0);
  });
}

module.exports = {
  evaluarActivo,
  ordenarPorFuerzaSenal,
  calcularRSCMansfield,
  evaluarVela,
  evaluarVolumen,
  detectarPullbackEMA20,
  detectarPullbackEMA50,
  detectarPullbackEMA100,
  detectarExtensionEMA50,
  detectarRoturaEMA50,
  evaluarStochRSI,
  evaluarSPX,
  detectarPatronesVela,
  subirSenal,
  PRIORIDAD_SENAL
};
