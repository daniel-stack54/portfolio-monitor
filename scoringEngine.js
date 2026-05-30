// ============================================================================
// PORTFOLIO MONITOR - MOTOR ZONA MEDIAS MÓVILES v5.0
// Regla única: sin zona de soporte → sin compra, punto.
//
// GATES (en orden):
//   1) precio < EMA200           → VENDER (hard veto)
//   2) NOT en zona ±3% EMA20/WMA50/WMA100 → MANTENER
//   3) En zona + sin vela verde  → VIGILAR_PULLBACK
//   4) En zona + vela verde      → COMPRA_FUERTE / COMPRA / COMPRA_PARCIAL
//
// ZONAS DE SOPORTE VÁLIDAS:
//   ZONA_EMA20:   precio entre EMA20*0.97  y EMA20*1.03
//   ZONA_WMA50:   precio entre WMA50*0.97  y WMA50*1.03
//   ZONA_WMA100:  precio entre WMA100*0.97 y WMA100*1.03
//
// CALIDAD DE ENTRADA (solo si en zona + vela verde):
//   stoch_valido   = StochRSI en [40,70] AND actual > anterior
//   volumen_fuerte = ratioVolumen >= 1.2
//   vela_con_cuerpo = cuerpo >= 40% del rango
// ============================================================================

'use strict';

const pct     = (a, b) => (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) ? 0 : ((a - b) / b) * 100;
const isValid = v => Number.isFinite(v) && v > 0;

// ============================================================================
// RSC MANSFIELD DIARIO (compatibilidad server.js)
// ============================================================================

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
// EVALUACIÓN DE VELA
// ============================================================================

function evaluarVela(v) {
  if (!v) return { esVerde: false, conCuerpo: false, cierreAlto: false, ratio: 0 };
  const range   = (v.high || 0) - (v.low || 0);
  const body    = Math.abs((v.close || 0) - (v.open || 0));
  const esVerde = (v.close || 0) > (v.open || 0);
  const ratio   = range > 0 ? body / range : 0;
  const cierreAlto = range > 0 ? ((v.close - v.low) / range) >= 0.6 : false;
  return { esVerde, conCuerpo: esVerde && ratio >= 0.4, cierreAlto, ratio };
}

// ============================================================================
// EVALUACIÓN DE VOLUMEN
// ============================================================================

function evaluarVolumen(velaActual, velasRecientes) {
  if (!velaActual || !Array.isArray(velasRecientes) || velasRecientes.length < 10)
    return { superior: false, ratio: 1 };
  const volActual = velaActual.volume || 0;
  const ultimas   = velasRecientes.slice(-11, -1);
  const promedio  = ultimas.reduce((s, v) => s + (v.volume || 0), 0) / ultimas.length;
  const ratio     = promedio > 0 ? volActual / promedio : 1;
  return { superior: ratio >= 1.2, muyAlto: ratio >= 1.5, ratio: Math.round(ratio * 100) / 100 };
}

// ============================================================================
// PATRONES DE VELA (badges informativos)
// ============================================================================

function esHammer(velas) {
  const v = velas[velas.length - 1];
  if (!v) return false;
  const body = Math.abs(v.close - v.open), range = v.high - v.low;
  const lw = Math.min(v.open, v.close) - v.low;
  const uw = v.high - Math.max(v.open, v.close);
  return range > 0 && body / range < 0.35 && lw >= 2 * body && uw / range < 0.2;
}

function esBullishEngulfing(velas) {
  if (velas.length < 2) return false;
  const p = velas[velas.length - 2], c = velas[velas.length - 1];
  return p.open > p.close && c.close > c.open && c.open <= p.close && c.close >= p.open;
}

function esThreeWhiteSoldiers(velas) {
  if (velas.length < 3) return false;
  const v1 = velas[velas.length-3], v2 = velas[velas.length-2], v3 = velas[velas.length-1];
  return v1.close>v1.open && v2.close>v2.open && v3.close>v3.open &&
         v2.close>v1.close && v3.close>v2.close && v2.open>=v1.open && v3.open>=v2.open;
}

function esMorningStar(velas) {
  if (velas.length < 3) return false;
  const v1 = velas[velas.length-3], v2 = velas[velas.length-2], v3 = velas[velas.length-1];
  const b1 = Math.abs(v1.close-v1.open), b2 = Math.abs(v2.close-v2.open);
  return v1.open>v1.close && b2<b1*0.5 && v3.close>v3.open &&
         Math.abs(v3.close-v3.open)>b2 && v3.close>(v1.open+v1.close)/2;
}

function detectarPatronesVela(velas) {
  if (!Array.isArray(velas) || !velas.length) return null;
  if (velas.length >= 3 && esThreeWhiteSoldiers(velas)) return { patron:'THREE_WHITE_SOLDIERS', icono:'🕯️', nombre:'Tres Soldados' };
  if (velas.length >= 3 && esMorningStar(velas))         return { patron:'MORNING_STAR',        icono:'🌟', nombre:'Estrella Matutina' };
  if (velas.length >= 2 && esBullishEngulfing(velas))    return { patron:'BULLISH_ENGULFING',   icono:'🕯️', nombre:'Envolvente Alcista' };
  if (esHammer(velas))                                    return { patron:'HAMMER',              icono:'🔨', nombre:'Martillo' };
  return null;
}

// ============================================================================
// ESTADO SPX (badge informativo)
// ============================================================================

function evaluarSPX(spxPrecio, spxEma20) {
  if (!isValid(spxPrecio) || !isValid(spxEma20))
    return { favorable: false, distancia: null, estado: 'DESCONOCIDO' };
  const dist = pct(spxPrecio, spxEma20);
  if (dist >= -2 && dist <= 1)  return { favorable: true,  distancia: dist, estado: 'FAVORABLE' };
  if (dist > 1 && dist <= 2.5)  return { favorable: false, distancia: dist, estado: 'EXTENDIDO_LEVE' };
  if (dist < -2 && dist >= -4)  return { favorable: false, distancia: dist, estado: 'CORRECCION_LEVE' };
  return { favorable: false, distancia: dist, estado: dist > 0 ? 'EXTENDIDO' : 'CORRECCION_FUERTE' };
}

// ============================================================================
// STOCHRSI DETALLADO (badge informativo)
// ============================================================================

function evaluarStochRSIDetallado(stochRsi, stochRsiPrev) {
  if (stochRsi == null) return { zona: 'DESCONOCIDO', giroValido: false, valor: null, subiendo: null };
  const subiendo   = stochRsiPrev != null ? stochRsi > stochRsiPrev : null;
  const giroValido = subiendo === true && stochRsi >= 40 && stochRsi <= 70;
  let zona;
  if (stochRsi > 80)       zona = 'ZONA_PELIGROSA';
  else if (stochRsi >= 40) zona = 'ZONA_OPTIMA';
  else if (stochRsi >= 20) zona = 'ZONA_ACEPTABLE';
  else                     zona = 'ZONA_BAJA';
  return { zona, giroValido, subiendo, valor: stochRsi };
}

// ============================================================================
// DETECCIÓN DE ZONA DE SOPORTE — NÚCLEO DE LA LÓGICA v5.0
// El precio debe estar dentro de ±3% de EMA20, WMA50 o WMA100.
// Si no está en ninguna zona → nunca hay señal de compra.
// ============================================================================

function detectarZonaSoporte(datos) {
  const { precio, ema20, wma50, wma100 } = datos;
  const MARGEN = 0.03;

  // ── COMPROBACIÓN PREVIA OBLIGATORIA ──────────────────────────────────────
  // Si el precio está más de 3% POR ENCIMA de EMA20, el activo está extendido
  // al alza. No hay pullback posible → bloquear cualquier señal de compra.
  if (isValid(ema20)) {
    const distEMA20raw = (precio - ema20) / ema20 * 100;
    if (distEMA20raw > 3) {
      return {
        enZona: false, zonaActiva: null,
        enEMA20: false, enWMA50: false, enWMA100: false,
        distEMA20:  distEMA20raw.toFixed(2) + '%',
        distWMA50:  isValid(wma50)  ? pct(precio, wma50).toFixed(2)  + '%' : 'N/D',
        distWMA100: isValid(wma100) ? pct(precio, wma100).toFixed(2) + '%' : 'N/D',
        razon: `Precio extendido sobre EMA20: +${distEMA20raw.toFixed(1)}%`
      };
    }
  }

  const enEMA20  = isValid(ema20)  && precio >= ema20  * (1 - MARGEN) && precio <= ema20  * (1 + MARGEN);
  const enWMA50  = isValid(wma50)  && precio >= wma50  * (1 - MARGEN) && precio <= wma50  * (1 + MARGEN);
  const enWMA100 = isValid(wma100) && precio >= wma100 * (1 - MARGEN) && precio <= wma100 * (1 + MARGEN);

  const enZona    = enEMA20 || enWMA50 || enWMA100;
  // Prioridad: la zona más cercana al precio gana
  let zonaActiva = null;
  if (enEMA20 || enWMA50 || enWMA100) {
    const distancias = [];
    if (enEMA20  && isValid(ema20))  distancias.push({ zona: 'EMA20',  dist: Math.abs(pct(precio, ema20))  });
    if (enWMA50  && isValid(wma50))  distancias.push({ zona: 'WMA50',  dist: Math.abs(pct(precio, wma50))  });
    if (enWMA100 && isValid(wma100)) distancias.push({ zona: 'WMA100', dist: Math.abs(pct(precio, wma100)) });
    distancias.sort((a, b) => a.dist - b.dist);
    zonaActiva = distancias[0]?.zona ?? null;
  }

  const distEMA20  = isValid(ema20)  ? pct(precio, ema20).toFixed(2)  + '%' : 'N/D';
  const distWMA50  = isValid(wma50)  ? pct(precio, wma50).toFixed(2)  + '%' : 'N/D';
  const distWMA100 = isValid(wma100) ? pct(precio, wma100).toFixed(2) + '%' : 'N/D';

  return { enZona, zonaActiva, enEMA20, enWMA50, enWMA100, distEMA20, distWMA50, distWMA100 };
}

// ============================================================================
// FUNCIÓN PRINCIPAL — EVALUAR ACTIVO v5.0
// ============================================================================

function evaluarActivo(datos) {
  const ticker = datos.ticker || 'DESCONOCIDO';

  if (!isValid(datos.precio) || !isValid(datos.ema200)) {
    return { ticker, senal: 'SIN_DATOS', alertas: [], cantidadAlertas: 0, razon: 'Datos insuficientes', detalles: null };
  }

  // ── PASO 1: Hard veto EMA200 ───────────────────────────────────────────────
  if (datos.precio < datos.ema200) {
    const urgente = (datos.pendienteEMA200 || 0) < -0.05;
    return {
      ticker, senal: 'VENDER',
      razon: urgente
        ? '⚠️ Precio bajo EMA200 con pendiente negativa — salida urgente'
        : 'Precio bajo EMA200 — fuera de tendencia',
      alertas: [], cantidadAlertas: 0,
      detalles: {
        precio: datos.precio, zonaActiva: null, enZona: false,
        distEMA20: 'N/D', distWMA50: 'N/D', distWMA100: 'N/D',
        distEma200: pct(datos.precio, datos.ema200).toFixed(2) + '%',
        stochRsi: datos.stochRsi, volumenRatio: datos.ratioVolumen,
        pendienteEMA200: datos.pendienteEMA200, macroEstado: datos.macroEstado,
        regimen: null, fuerza: null, pullbackReal: null,
        pullbackRetroceso: null, pullbackVelasRojas: null, condiciones7: null
      }
    };
  }

  // ── Evaluaciones base (para badges y detalles) ─────────────────────────────
  const velaActual = datos.velas?.[datos.velas.length - 1];
  const vela    = evaluarVela(velaActual);
  const volumen = evaluarVolumen(velaActual, datos.velas);
  const stoch   = evaluarStochRSIDetallado(datos.stochRsi, datos.stochRsiPrev);
  const spx     = evaluarSPX(datos.spxPrecio, datos.spxEma20);
  const patron  = detectarPatronesVela(datos.velas);

  // ── Badges informativos ────────────────────────────────────────────────────
  const alertas = [];

  if (spx.favorable)
    alertas.push({ icono: '📈', tipo: 'SPX_FAVORABLE', mensaje: `SPX favorable (${spx.distancia?.toFixed(2)}%)` });
  if (vela.esVerde)
    alertas.push({ icono: vela.conCuerpo ? '🟢' : '🟩', tipo: 'VELA_VERDE',
      mensaje: vela.conCuerpo ? `Vela verde cuerpo (${(vela.ratio*100).toFixed(0)}%)` : 'Vela verde' });
  if (volumen.superior)
    alertas.push({ icono: volumen.muyAlto ? '🔊' : '🔉', tipo: 'VOLUMEN', mensaje: `Vol ${volumen.ratio}x` });
  if (patron)
    alertas.push({ icono: patron.icono, tipo: patron.patron, mensaje: patron.nombre });

  // Mansfield alert: pendiente semanal pasa de negativa a positiva
  const alertaMansfield = (datos.mansfieldSemanal?.pendiente ?? 0) > 0
    && (datos.mansfieldSemanal?.mrs_anterior ?? 0) <= 0;
  if (alertaMansfield)
    alertas.push({ icono: '🔔', tipo: 'ALERTA_MANSFIELD', mensaje: 'Mansfield girando ↑ desde negativo' });

  const mrsVal = datos.mansfieldSemanal?.valor ?? datos.rsc?.valor ?? null;
  if (mrsVal !== null && mrsVal > 5 && (datos.mansfieldSemanal?.pendiente ?? 0) > 0)
    alertas.push({ icono: '💪', tipo: 'RSC_FUERTE', mensaje: `Mansfield ${mrsVal.toFixed(1)}` });

  // ── PASO 2: ¿Está en zona de soporte ±3%? ─────────────────────────────────
  const zona = detectarZonaSoporte(datos);

  if (!zona.enZona) {
    return _resultado(ticker, 'MANTENER',
      `Fuera de zona soporte | EMA20:${zona.distEMA20} WMA50:${zona.distWMA50} WMA100:${zona.distWMA100}`,
      alertas, datos, zona);
  }

  // Badge zona soporte
  alertas.unshift({ icono: '🎯', tipo: 'ZONA_SOPORTE',
    mensaje: `En zona ${zona.zonaActiva} (dist:${zona['dist' + zona.zonaActiva] || ''})` });

  // ── PASO 3: ¿Vela verde de confirmación? ──────────────────────────────────
  if (!vela.esVerde) {
    return _resultado(ticker, 'VIGILAR_PULLBACK',
      `Precio en zona ${zona.zonaActiva} — esperar vela verde de confirmación`,
      alertas, datos, zona);
  }

  // ── PASO 4: Vela verde → calidad de entrada ────────────────────────────────
  const stochValido = (
    Number.isFinite(datos.stochRsi) &&
    datos.stochRsi >= 40 && datos.stochRsi <= 70 &&
    Number.isFinite(datos.stochRsiPrev) &&
    datos.stochRsi > datos.stochRsiPrev
  );
  const volumenFuerte = (datos.ratioVolumen || 0) >= 1.2;

  if (stochValido)
    alertas.push({ icono: '📊', tipo: 'STOCH_GIRO',
      mensaje: `StochRSI ${datos.stochRsi?.toFixed(1)} giro ↑ (zona 40-70)` });

  let senal, razon;

  if (vela.conCuerpo && stochValido && volumenFuerte) {
    senal = 'COMPRA_FUERTE';
    razon = `Zona ${zona.zonaActiva} + vela cuerpo ${(vela.ratio*100).toFixed(0)}% + StochRSI ${datos.stochRsi?.toFixed(1)} giro↑ + vol ${volumen.ratio}x`;
  } else if (vela.conCuerpo && stochValido) {
    senal = 'COMPRA';
    razon = `Zona ${zona.zonaActiva} + vela cuerpo ${(vela.ratio*100).toFixed(0)}% + StochRSI ${datos.stochRsi?.toFixed(1)} giro↑`;
  } else if (vela.conCuerpo) {
    senal = 'COMPRA_PARCIAL';
    razon = `Zona ${zona.zonaActiva} + vela cuerpo ${(vela.ratio*100).toFixed(0)}% (StochRSI ${datos.stochRsi?.toFixed(1)} no en 40-70↑)`;
  } else {
    senal = 'COMPRA_PARCIAL';
    razon = `Zona ${zona.zonaActiva} + vela verde sin cuerpo suficiente (ratio:${(vela.ratio*100).toFixed(0)}%)`;
  }

  return _resultado(ticker, senal, razon, alertas, datos, zona);
}

// ── Helper resultado ───────────────────────────────────────────────────────────

function _resultado(ticker, senal, razon, alertas, datos, zona) {
  return {
    ticker, senal, razon, alertas,
    cantidadAlertas: alertas.length,
    detalles: {
      precio:          datos.precio,
      zonaActiva:      zona?.zonaActiva   ?? null,
      enZona:          zona?.enZona       ?? false,
      distEMA20:       zona?.distEMA20    ?? (isValid(datos.ema20)  ? pct(datos.precio, datos.ema20).toFixed(2)  + '%' : 'N/D'),
      distWMA50:       zona?.distWMA50    ?? (isValid(datos.wma50)  ? pct(datos.precio, datos.wma50).toFixed(2)  + '%' : 'N/D'),
      distWMA100:      zona?.distWMA100   ?? (isValid(datos.wma100) ? pct(datos.precio, datos.wma100).toFixed(2) + '%' : 'N/D'),
      distEma200:      isValid(datos.ema200) ? pct(datos.precio, datos.ema200).toFixed(2) + '%' : 'N/D',
      stochRsi:        datos.stochRsi,
      volumenRatio:    datos.ratioVolumen,
      pendienteEMA200: datos.pendienteEMA200,
      macroEstado:     datos.macroEstado,
      // Campos backward compat (ya no se calculan)
      regimen:            null,
      fuerza:             null,
      pullbackReal:       null,
      pullbackRetroceso:  null,
      pullbackVelasRojas: null,
      condiciones7:       null
    }
  };
}

// ============================================================================
// ORDENAR POR SEÑAL
// ============================================================================

const PRIORIDAD_SENAL = {
  COMPRA_FUERTE: 1, COMPRA: 2, COMPRA_PARCIAL: 3,
  VIGILAR_PULLBACK: 4, VIGILAR_REBOTE: 5, MANTENER: 6, VENDER: 7, SIN_DATOS: 8
};

function ordenarPorFuerzaSenal(resultados) {
  return resultados.sort((a, b) => {
    const pa = PRIORIDAD_SENAL[a.senal] || 99, pb = PRIORIDAD_SENAL[b.senal] || 99;
    return pa !== pb ? pa - pb : (b.cantidadAlertas || 0) - (a.cantidadAlertas || 0);
  });
}

module.exports = {
  evaluarActivo,
  ordenarPorFuerzaSenal,
  calcularRSCMansfield,
  evaluarVela,
  evaluarVolumen,
  detectarPatronesVela,
  detectarZonaSoporte,
  evaluarSPX,
  evaluarStochRSIDetallado,
  PRIORIDAD_SENAL
};
