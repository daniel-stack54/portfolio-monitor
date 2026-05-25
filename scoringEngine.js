// ============================================================================
// PORTFOLIO MONITOR - MOTOR DE SEÑALES v3.0
// ============================================================================
// REDISEÑO TOTAL — Lógica simplificada centrada en pullback + confirmación
//
// SEÑALES DISPONIBLES:
//   - VENDER          : precio < EMA200 (descartada, fuera de portfolio)
//   - COMPRA_FUERTE   : pullback/rotura + vela verde con cuerpo + volumen alto
//   - COMPRA          : pullback/rotura + vela verde (sin volumen fuerte)
//   - COMPRA_PARCIAL  : rotura EMA50 con vela verde sin cuerpo grande
//   - VIGILAR_PULLBACK: precio acercándose a zona ±3% EMA20
//   - VIGILAR_REBOTE  : precio extendido bajo EMA50 (-3% o más)
//   - MANTENER        : posición normal en tendencia
//
// ALERTAS ACUMULABLES (badges 🔔, no son señales, son indicadores de fuerza):
//   1) Precio en zona ±3% EMA20 (pullback hacia abajo)
//   2) RSI estocástico entre 40-75
//   3) SPX favorable (-2% a +1% EMA20)
//   4) Vela verde de confirmación (cierre > apertura)
//   5) Volumen claramente superior al promedio reciente
//
// Más alertas acumuladas = señal más fuerte
// ============================================================================

const pct = (a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a - b) / b) * 100;
};

const isValidNumber = (v) => Number.isFinite(v) && v > 0;

// ============================================================================
// DETECCIÓN DE VELA VERDE Y SU FUERZA
// ============================================================================

function evaluarVela(velaActual) {
  if (!velaActual) return { esVerde: false, conCuerpo: false, ratio: 0 };
  const open = velaActual.open || 0;
  const close = velaActual.close || 0;
  const high = velaActual.high || 0;
  const low = velaActual.low || 0;

  const esVerde = close > open;
  const rango = high - low;
  const cuerpo = Math.abs(close - open);
  const ratio = rango > 0 ? cuerpo / rango : 0;

  return {
    esVerde,
    conCuerpo: esVerde && ratio > 0.5,  // cuerpo > 50% del rango total
    ratio
  };
}

// ============================================================================
// DETECCIÓN DE VOLUMEN SUPERIOR
// ============================================================================

function evaluarVolumen(velaActual, velasRecientes) {
  if (!velaActual || !Array.isArray(velasRecientes) || velasRecientes.length < 10) {
    return { superior: false, ratio: 1 };
  }
  const volActual = velaActual.volume || 0;
  // Promedio de las últimas 10 velas excluyendo la actual
  const ultimas10 = velasRecientes.slice(-11, -1);
  const promedio = ultimas10.reduce((s, v) => s + (v.volume || 0), 0) / ultimas10.length;
  const ratio = promedio > 0 ? volActual / promedio : 1;

  return {
    superior: ratio >= 1.2,         // 20% o más sobre el promedio
    muyAlto: ratio >= 1.5,          // 50% o más
    ratio: Math.round(ratio * 100) / 100
  };
}

// ============================================================================
// DETECCIÓN DE PULLBACK HACIA ZONA EMA20
// ============================================================================

function detectarPullbackEMA20(precio, ema20, velas) {
  if (!isValidNumber(precio) || !isValidNumber(ema20)) {
    return { enZona: false, distancia: null };
  }
  const dist = pct(precio, ema20);

  // Zona de pullback: ±3% de EMA20
  const enZona = Math.abs(dist) <= 3;

  // Detectar si viene de un pullback (precio bajó desde más arriba)
  let vieneDePullback = false;
  if (Array.isArray(velas) && velas.length >= 5) {
    const max5dias = Math.max(...velas.slice(-5).map(v => v.high || 0));
    const distanciaDesdeMax = pct(precio, max5dias);
    vieneDePullback = distanciaDesdeMax < -1; // bajó al menos 1% desde el máximo reciente
  }

  return {
    enZona,
    distancia: dist,
    vieneDePullback
  };
}

// ============================================================================
// DETECCIÓN DE EXTENSIÓN BAJO EMA50 (oportunidad de rebote)
// ============================================================================

function detectarExtensionEMA50(precio, ema50) {
  if (!isValidNumber(precio) || !isValidNumber(ema50)) {
    return { extendido: false, distancia: null };
  }
  const dist = pct(precio, ema50);

  // Extendido bajo EMA50: -3% o más
  return {
    extendido: dist <= -3,
    distancia: dist
  };
}

// ============================================================================
// DETECCIÓN DE ROTURA AL ALZA DE EMA50
// ============================================================================

function detectarRoturaEMA50(precio, ema50, velas) {
  if (!isValidNumber(precio) || !isValidNumber(ema50) ||
      !Array.isArray(velas) || velas.length < 3) {
    return { rotura: false };
  }

  // Las últimas 2-3 velas estaban por debajo de EMA50 y la actual está por encima
  const velaActual = velas[velas.length - 1];
  const velaAnterior = velas[velas.length - 2];
  const velaAnterior2 = velas[velas.length - 3];

  if (!velaActual || !velaAnterior) return { rotura: false };

  const cierreActual = velaActual.close || 0;
  const cierreAnt = velaAnterior.close || 0;
  const cierreAnt2 = velaAnterior2 ? (velaAnterior2.close || 0) : cierreAnt;

  // Anterior bajo EMA50, actual sobre EMA50
  const rotura = cierreAnt < ema50 && cierreActual > ema50;
  // O al menos las 2 anteriores estaban bajo y ahora la actual rebasa
  const roturaConfirmada = (cierreAnt < ema50 || cierreAnt2 < ema50) && cierreActual > ema50;

  return {
    rotura: roturaConfirmada,
    cierreActual,
    ema50
  };
}

// ============================================================================
// RSI ESTOCÁSTICO EN ZONA FAVORABLE (40-75)
// ============================================================================

function evaluarStochRSI(stochRsi) {
  if (!Number.isFinite(stochRsi)) return { enZona: false, valor: null };
  return {
    enZona: stochRsi >= 40 && stochRsi <= 75,
    valor: stochRsi
  };
}

// ============================================================================
// ESTADO DEL SPX (mercado favorable)
// ============================================================================

function evaluarSPX(spxPrecio, spxEma20) {
  if (!isValidNumber(spxPrecio) || !isValidNumber(spxEma20)) {
    return { favorable: false, distancia: null, estado: 'DESCONOCIDO' };
  }
  const dist = pct(spxPrecio, spxEma20);

  // Zona favorable: -2% a +1% EMA20
  if (dist >= -2 && dist <= 1) {
    return { favorable: true, distancia: dist, estado: 'FAVORABLE' };
  }
  // Aceptable (no penaliza pero no premia)
  if (dist > 1 && dist <= 2.5) {
    return { favorable: false, distancia: dist, estado: 'EXTENDIDO_LEVE' };
  }
  if (dist < -2 && dist >= -4) {
    return { favorable: false, distancia: dist, estado: 'CORRECCION_LEVE' };
  }
  // Extendido
  return {
    favorable: false,
    distancia: dist,
    estado: dist > 0 ? 'EXTENDIDO' : 'CORRECCION_FUERTE'
  };
}

// ============================================================================
// FUNCIÓN PRINCIPAL — EVALUAR ACTIVO
// ============================================================================

function evaluarActivo(datos) {
  // Validación de datos esenciales
  if (!isValidNumber(datos.precio) || !isValidNumber(datos.ema20) ||
      !isValidNumber(datos.ema50) || !isValidNumber(datos.ema200)) {
    return {
      ticker: datos.ticker || 'DESCONOCIDO',
      senal: 'SIN_DATOS',
      alertas: [],
      detalles: null
    };
  }

  // ====== VETO ABSOLUTO ======
  if (datos.precio < datos.ema200) {
    return {
      ticker: datos.ticker,
      senal: 'VENDER',
      razon: 'Precio bajo EMA200 — fuera de tendencia',
      alertas: [],
      detalles: {
        precio: datos.precio,
        ema200: datos.ema200,
        distEma200: pct(datos.precio, datos.ema200).toFixed(2) + '%'
      }
    };
  }

  // ====== DETECCIONES BÁSICAS ======
  const pullback     = detectarPullbackEMA20(datos.precio, datos.ema20, datos.velas);
  const extension50  = detectarExtensionEMA50(datos.precio, datos.ema50);
  const rotura50     = detectarRoturaEMA50(datos.precio, datos.ema50, datos.velas);
  const vela         = evaluarVela(datos.velas?.[datos.velas.length - 1]);
  const volumen      = evaluarVolumen(datos.velas?.[datos.velas.length - 1], datos.velas);
  const stochRsi     = evaluarStochRSI(datos.stochRsi);
  const spx          = evaluarSPX(datos.spxPrecio, datos.spxEma20);

  // ====== ALERTAS ACUMULABLES ======
  const alertas = [];

  if (pullback.enZona) {
    alertas.push({
      icono: '🎯',
      tipo: 'PULLBACK_EMA20',
      mensaje: `Precio en zona EMA20 (${pullback.distancia.toFixed(2)}%)`
    });
  }
  if (stochRsi.enZona) {
    alertas.push({
      icono: '📊',
      tipo: 'STOCH_RSI',
      mensaje: `StochRSI en zona favorable (${stochRsi.valor.toFixed(1)})`
    });
  }
  if (spx.favorable) {
    alertas.push({
      icono: '📈',
      tipo: 'SPX_FAVORABLE',
      mensaje: `SPX en zona favorable (${spx.distancia.toFixed(2)}%)`
    });
  }
  if (vela.esVerde) {
    alertas.push({
      icono: vela.conCuerpo ? '🟢' : '🟩',
      tipo: vela.conCuerpo ? 'VELA_VERDE_FUERTE' : 'VELA_VERDE',
      mensaje: vela.conCuerpo ? 'Vela verde con cuerpo' : 'Vela verde'
    });
  }
  if (volumen.superior) {
    alertas.push({
      icono: volumen.muyAlto ? '🔊' : '🔉',
      tipo: volumen.muyAlto ? 'VOLUMEN_ALTO' : 'VOLUMEN_SUPERIOR',
      mensaje: `Volumen ${volumen.ratio}x promedio`
    });
  }

  // ====== DECISIÓN DE SEÑAL ======
  let senal = 'MANTENER';
  let razon = '';

  // 1) ROTURA EMA50 AL ALZA (oportunidad fuerte)
  if (rotura50.rotura && vela.esVerde) {
    if (vela.conCuerpo && volumen.superior) {
      senal = 'COMPRA_FUERTE';
      razon = 'Rotura EMA50 al alza + vela verde con cuerpo + volumen';
    } else if (vela.conCuerpo) {
      senal = 'COMPRA';
      razon = 'Rotura EMA50 al alza + vela verde con cuerpo';
    } else if (volumen.superior) {
      senal = 'COMPRA';
      razon = 'Rotura EMA50 al alza + vela verde + volumen';
    } else {
      senal = 'COMPRA_PARCIAL';
      razon = 'Rotura EMA50 al alza + vela verde';
    }
  }
  // 2) PULLBACK A ZONA EMA20 + CONFIRMACIÓN
  else if (pullback.enZona && vela.esVerde) {
    if (vela.conCuerpo && volumen.superior) {
      senal = 'COMPRA_FUERTE';
      razon = 'Pullback a EMA20 + vela verde con cuerpo + volumen';
    } else if (vela.conCuerpo) {
      senal = 'COMPRA';
      razon = 'Pullback a EMA20 + vela verde con cuerpo';
    } else if (volumen.superior) {
      senal = 'COMPRA';
      razon = 'Pullback a EMA20 + vela verde + volumen';
    } else {
      senal = 'COMPRA_PARCIAL';
      razon = 'Pullback a EMA20 + vela verde';
    }
  }
  // 3) PULLBACK SIN CONFIRMACIÓN AÚN
  else if (pullback.enZona && pullback.vieneDePullback) {
    senal = 'VIGILAR_PULLBACK';
    razon = `Precio en zona EMA20 (${pullback.distancia.toFixed(2)}%), esperar vela verde de confirmación`;
  }
  // 4) EXTENDIDO BAJO EMA50 (esperar rebote)
  else if (extension50.extendido) {
    senal = 'VIGILAR_REBOTE';
    razon = `Precio ${extension50.distancia.toFixed(2)}% bajo EMA50, esperar rebote con vela verde`;
  }
  // 5) PRECIO CERCA DE EMA20 PERO SIN PULLBACK (consolidación)
  else if (Math.abs(pullback.distancia || 999) <= 5) {
    senal = 'MANTENER';
    razon = 'Cerca de EMA20, sin señal clara de entrada';
  }
  // 6) Resto
  else {
    senal = 'MANTENER';
    razon = 'En tendencia, sin pullback ni rotura';
  }

  return {
    ticker: datos.ticker,
    senal,
    razon,
    alertas,
    cantidadAlertas: alertas.length,
    detalles: {
      precio: datos.precio,
      distEma20: pullback.distancia !== null ? pullback.distancia.toFixed(2) + '%' : 'N/D',
      distEma50: extension50.distancia !== null ? extension50.distancia.toFixed(2) + '%' : 'N/D',
      distEma200: pct(datos.precio, datos.ema200).toFixed(2) + '%',
      stochRsi: stochRsi.valor,
      vela: vela.esVerde ? (vela.conCuerpo ? 'VERDE_CUERPO' : 'VERDE') : 'ROJA',
      volumenRatio: volumen.ratio,
      spxEstado: spx.estado,
      spxDist: spx.distancia !== null ? spx.distancia.toFixed(2) + '%' : 'N/D'
    }
  };
}

// ============================================================================
// ORDENAR RESULTADOS POR FUERZA DE SEÑAL (Opción B - sin importar peso)
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
    // A misma señal, más alertas = más arriba
    return (b.cantidadAlertas || 0) - (a.cantidadAlertas || 0);
  });
}

module.exports = {
  evaluarActivo,
  ordenarPorFuerzaSenal,
  evaluarVela,
  evaluarVolumen,
  detectarPullbackEMA20,
  detectarExtensionEMA50,
  detectarRoturaEMA50,
  evaluarStochRSI,
  evaluarSPX,
  PRIORIDAD_SENAL
};
