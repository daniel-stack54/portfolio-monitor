// ============================================================================
// PORTFOLIO MONITOR - MOTOR CONFLUENCIA v4.1
// Regla universal: sin pullback real verificado → sin compra jamás
// ============================================================================

'use strict';

const pct     = (a, b) => (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) ? 0 : ((a - b) / b) * 100;
const isValid = v => Number.isFinite(v) && v > 0;

// ============================================================================
// RSC MANSFIELD DIARIO (compatibilidad)
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
  const range   = v.high - v.low;
  const body    = Math.abs(v.close - v.open);
  const esVerde = v.close > v.open;
  const ratio   = range > 0 ? body / range : 0;
  const cierreAlto = range > 0 ? (v.close - v.low) / range >= 0.6 : false;
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
// PATRONES DE VELA
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
// ESTADO SPX
// ============================================================================

function evaluarSPX(spxPrecio, spxEma20) {
  if (!isValid(spxPrecio) || !isValid(spxEma20)) return { favorable: false, distancia: null, estado: 'DESCONOCIDO' };
  const dist = pct(spxPrecio, spxEma20);
  if (dist >= -2 && dist <= 1)   return { favorable: true,  distancia: dist, estado: 'FAVORABLE' };
  if (dist > 1 && dist <= 2.5)   return { favorable: false, distancia: dist, estado: 'EXTENDIDO_LEVE' };
  if (dist < -2 && dist >= -4)   return { favorable: false, distancia: dist, estado: 'CORRECCION_LEVE' };
  return { favorable: false, distancia: dist, estado: dist > 0 ? 'EXTENDIDO' : 'CORRECCION_FUERTE' };
}

// ============================================================================
// RÉGIMEN DE MERCADO
// ============================================================================

function evaluarRegimen(datos) {
  const { precio, ema200, wma20, wma50, pendienteEMA200 } = datos;
  if (!isValid(precio) || !isValid(ema200)) return 'DESCONOCIDO';
  if (precio < ema200) return 'BAJISTA';
  const p = pendienteEMA200 || 0;
  if (p > 0 && isValid(wma20) && isValid(wma50) && precio > wma20 && wma20 > wma50)
    return 'ALCISTA_FUERTE';
  if (Math.abs(p) < 0.1) return 'NEUTRAL';
  return 'ALCISTA_ACEPTABLE';
}

// ============================================================================
// FUERZA RELATIVA (semanal > diario)
// ============================================================================

function evaluarFuerzaRelativa(datos) {
  const mrsW  = datos.mansfieldSemanal?.valor;
  const pendW = datos.mansfieldSemanal?.pendiente;
  const mrsD  = datos.rsc?.valor;
  const pendD = datos.rsc?.subiendo === true ? 1 : datos.rsc?.subiendo === false ? -1 : 0;
  const mrs      = mrsW ?? mrsD ?? null;
  const pendiente = pendW ?? pendD;
  if (mrs === null) return 'DESCONOCIDO';
  if (mrs > 5  && pendiente > 0)  return 'LIDERAZGO_FUERTE';
  if (mrs > 0  && pendiente >= 0) return 'LIDERAZGO_MODERADO';
  if (mrs > -2 && pendiente > 0)  return 'NEUTRAL_POSITIVO';
  return 'DEBIL';
}

// ============================================================================
// STOCHRSI DETALLADO
// ============================================================================

function evaluarStochRSIDetallado(stochRsi, stochRsiPrev) {
  if (stochRsi == null) return { zona: 'DESCONOCIDO', giroValido: false, giroInvalido: false, valor: null };
  const subiendo     = stochRsiPrev != null ? stochRsi > stochRsiPrev : null;
  const giroValido   = subiendo === true && stochRsi >= 20 && stochRsi <= 75;
  const giroInvalido = stochRsi > 80;
  let zona;
  if (stochRsi > 80)       zona = 'ZONA_PELIGROSA';
  else if (stochRsi >= 40) zona = 'ZONA_OPTIMA';
  else if (stochRsi >= 20) zona = 'ZONA_ACEPTABLE';
  else                     zona = 'ZONA_BAJA';
  return { zona, giroValido, giroInvalido, subiendo, valor: stochRsi };
}

// ============================================================================
// PULLBACK REAL — VERIFICACIÓN OBLIGATORIA (PC0a + PC0b + PC0c)
// Sin pullback real → sin señal de compra, punto.
// ============================================================================

function verificarPullbackReal(datos) {
  const { precio, wma20, velas } = datos;
  if (!Array.isArray(velas) || velas.length < 10) {
    return { real: false, razon: 'Datos insuficientes', retroceso: 0, velasRojas: 0 };
  }

  // PC0a: Retroceso mínimo ≥2% desde máximos de los últimos 10 días
  const max10d    = Math.max(...velas.slice(-10).map(v => v.high || v.close || 0));
  const retroceso = max10d > 0 ? (max10d - precio) / max10d * 100 : 0;
  const pc0a      = retroceso >= 2;

  // PC0b: Al menos 2 velas rojas en las últimas 5
  const ultimas5  = velas.slice(-5);
  const velasRojas = ultimas5.filter(v => (v.close || 0) < (v.open || 0)).length;
  const pc0b      = velasRojas >= 2;

  // PC0c: Precio acercándose a WMA20 (más cerca hoy que hace 3 días)
  let pc0c = true; // si no hay WMA20, no penalizar
  if (isValid(wma20) && velas.length >= 4) {
    const cierre3ago = velas[velas.length - 4].close || precio;
    const distHoy   = Math.abs(precio - wma20) / wma20;
    const dist3ago  = Math.abs(cierre3ago - wma20) / wma20;
    // Si la diferencia es muy pequeña (<0.3%), considerar neutral (no bloquear)
    pc0c = distHoy <= dist3ago || (dist3ago - distHoy) < -0.003;
  }

  const real = pc0a && pc0b && pc0c;
  return { real, pc0a, pc0b, pc0c, retroceso: +retroceso.toFixed(2), velasRojas, max10d };
}

// ============================================================================
// 7 CONDICIONES DE CALIDAD (solo se evalúan si pullback real = true)
// ============================================================================

const NOMBRES_COND = {
  c1: 'régimen alcista fuerte',
  c2: 'liderazgo Mansfield ↑',
  c3: 'WMA20>WMA50>WMA100 alineadas',
  c4: 'volumen ≥1.0x promedio',
  c5: 'StochRSI giro válido 20-75',
  c6: 'vela verde cuerpo ≥40%',
  c7: 'cierre en 60% superior'
};

function evaluar7Condiciones(datos, regimen, fuerza, stoch) {
  const vela = evaluarVela(datos.velas?.[datos.velas.length - 1]);
  return {
    c1: regimen === 'ALCISTA_FUERTE',
    c2: fuerza  === 'LIDERAZGO_FUERTE',
    c3: isValid(datos.wma20) && isValid(datos.wma50) && isValid(datos.wma100)
        && datos.wma20 > datos.wma50 && datos.wma50 > datos.wma100,
    c4: (datos.ratioVolumen ?? 0) >= 1.0,
    c5: stoch.giroValido,
    c6: vela.esVerde && vela.conCuerpo,
    c7: vela.esVerde && vela.cierreAlto
  };
}

// ============================================================================
// HELPER: SUBIR SEÑAL UN NIVEL
// ============================================================================

function subirSenal(senal) {
  const up = { MANTENER:'VIGILAR_PULLBACK', VIGILAR_PULLBACK:'COMPRA_PARCIAL', VIGILAR_REBOTE:'COMPRA_PARCIAL', COMPRA_PARCIAL:'COMPRA', COMPRA:'COMPRA_FUERTE' };
  return up[senal] || senal;
}

// ============================================================================
// FUNCIÓN PRINCIPAL — EVALUAR ACTIVO v4.1
// ============================================================================

function evaluarActivo(datos) {
  if (!isValid(datos.precio) || !isValid(datos.ema200)) {
    return { ticker: datos.ticker || 'DESCONOCIDO', senal: 'SIN_DATOS', alertas: [], cantidadAlertas: 0, detalles: null };
  }

  // ─── PASO 1: Hard veto EMA200 ──────────────────────────────────────────────
  if (datos.precio < datos.ema200) {
    const urgente = (datos.pendienteEMA200 || 0) < -0.05;
    return {
      ticker: datos.ticker, senal: 'VENDER',
      razon: urgente
        ? '⚠️ Precio bajo EMA200 con pendiente negativa — salida urgente'
        : 'Precio bajo EMA200 — fuera de tendencia',
      alertas: [], cantidadAlertas: 0,
      detalles: { precio: datos.precio, regimen: 'BAJISTA', fuerza: 'DEBIL',
        distEma200: pct(datos.precio, datos.ema200).toFixed(2) + '%' }
    };
  }

  // ─── Evaluaciones base ────────────────────────────────────────────────────
  const regimen  = evaluarRegimen(datos);
  const fuerza   = evaluarFuerzaRelativa(datos);
  const stoch    = evaluarStochRSIDetallado(datos.stochRsi, datos.stochRsiPrev);
  const spx      = evaluarSPX(datos.spxPrecio, datos.spxEma20);
  const patron   = detectarPatronesVela(datos.velas);
  const volumen  = evaluarVolumen(datos.velas?.[datos.velas.length-1], datos.velas);
  const vela     = evaluarVela(datos.velas?.[datos.velas.length-1]);

  // Alerta temprana Mansfield (solo informativa, nunca genera compra)
  const alertaMansfield = (datos.mansfieldSemanal?.pendiente ?? 0) > 0
    && (datos.mansfieldSemanal?.mrs_anterior ?? 0) <= 0;

  // ─── Alertas (badges) ─────────────────────────────────────────────────────
  const alertas = [];
  if (spx.favorable)
    alertas.push({ icono: '📈', tipo: 'SPX_FAVORABLE',   mensaje: `SPX favorable (${spx.distancia?.toFixed(2)}%)` });
  if (vela.esVerde)
    alertas.push({ icono: vela.conCuerpo ? '🟢' : '🟩',  tipo: 'VELA_VERDE', mensaje: vela.conCuerpo ? 'Vela verde cuerpo' : 'Vela verde' });
  if (volumen.superior)
    alertas.push({ icono: volumen.muyAlto ? '🔊' : '🔉', tipo: 'VOLUMEN', mensaje: `Vol ${volumen.ratio}x` });
  if (patron)
    alertas.push({ icono: patron.icono, tipo: patron.patron, mensaje: patron.nombre });
  if (fuerza === 'LIDERAZGO_FUERTE' || fuerza === 'LIDERAZGO_MODERADO')
    alertas.push({ icono: '💪', tipo: 'RSC_FUERTE', mensaje: `Mansfield ${(datos.mansfieldSemanal?.valor ?? datos.rsc?.valor ?? 0).toFixed(1)}` });
  if (alertaMansfield)
    alertas.push({ icono: '🔔', tipo: 'ALERTA_MANSFIELD', mensaje: 'Mansfield girando ↑ (vigilar)' });
  if (regimen === 'ALCISTA_FUERTE')
    alertas.push({ icono: '🚀', tipo: 'REGIMEN_FUERTE', mensaje: 'Régimen alcista fuerte' });
  if (stoch.giroValido)
    alertas.push({ icono: '📊', tipo: 'STOCH_GIRO', mensaje: `StochRSI ${stoch.valor?.toFixed(1)} giro ↑` });

  let senal = 'MANTENER';
  let razon = '';

  // ─── PASO 2: Régimen ──────────────────────────────────────────────────────
  if (regimen === 'BAJISTA') {
    senal = 'VENDER'; razon = 'Régimen bajista — precio bajo EMA200';
    return _resultado(datos.ticker, senal, razon, alertas, datos, regimen, fuerza, null, stoch);
  }
  if (regimen === 'NEUTRAL') {
    senal = 'MANTENER';
    razon = `Régimen neutral — EMA200 plana (${(datos.pendienteEMA200 || 0).toFixed(3)}% cambio 10d)`;
    return _resultado(datos.ticker, senal, razon, alertas, datos, regimen, fuerza, null, stoch);
  }

  // ─── PASO 3: Fuerza relativa ──────────────────────────────────────────────
  if (fuerza === 'DEBIL') {
    const mrsVal = (datos.mansfieldSemanal?.valor ?? datos.rsc?.valor ?? null);
    const aviso  = alertaMansfield ? ' 🔔 Mansfield girando, vigilar' : '';
    senal = 'MANTENER';
    razon = `Mansfield ${mrsVal !== null ? mrsVal.toFixed(2) : 'N/D'} — sin liderazgo vs mercado${aviso}`;
    return _resultado(datos.ticker, senal, razon, alertas, datos, regimen, fuerza, null, stoch);
  }

  // ─── PASO 4: Pullback REAL obligatorio ────────────────────────────────────
  const pullReal = verificarPullbackReal(datos);

  if (!pullReal.real) {
    // Añadir badge 🎯 solo si hay alguna proximidad a soporte
    const distW20 = isValid(datos.wma20) ? Math.abs(pct(datos.precio, datos.wma20)) : 999;
    if (distW20 < 5) {
      alertas.push({ icono: '🎯', tipo: 'CERCA_SOPORTE', mensaje: `A ${distW20.toFixed(1)}% de WMA20 — esperar retroceso` });
    }

    let falta = [];
    if (!pullReal.pc0a) falta.push(`retroceso solo ${pullReal.retroceso.toFixed(1)}% (necesita ≥2%)`);
    if (!pullReal.pc0b) falta.push(`solo ${pullReal.velasRojas}/5 velas rojas (necesita ≥2)`);
    if (!pullReal.pc0c) falta.push('precio alejándose de WMA20 (impulso, no pullback)');

    senal = 'MANTENER';
    razon = `Sin pullback real: ${falta.join(' · ')}`;
    return _resultado(datos.ticker, senal, razon, alertas, datos, regimen, fuerza, pullReal, stoch);
  }

  // Confirmado que hay pullback real → añadir badge
  alertas.unshift({ icono: '🎯', tipo: 'PULLBACK_REAL', mensaje: `Pullback ${pullReal.retroceso.toFixed(1)}% desde máx, ${pullReal.velasRojas}/5 velas rojas` });

  // ─── PASO 5: Calidad de la entrada (7 condiciones) ────────────────────────
  const cond7    = evaluar7Condiciones(datos, regimen, fuerza, stoch);
  const cumple7  = Object.values(cond7).filter(Boolean).length;
  const faltanK  = Object.entries(cond7).filter(([, v]) => !v).map(([k]) => NOMBRES_COND[k]);

  if (cumple7 === 7) {
    senal = 'COMPRA_FUERTE';
    razon = 'Confluencia perfecta: pullback real + 7/7 condiciones';
  } else if (cumple7 === 6) {
    senal = 'COMPRA';
    razon = `Pullback real + 6/7 — falta: ${faltanK[0]}`;
  } else if (cumple7 === 5) {
    senal = 'COMPRA_PARCIAL';
    razon = `Pullback real + 5/7 — faltan: ${faltanK.join(', ')}`;
  } else {
    senal = 'VIGILAR_PULLBACK';
    razon = `Pullback real pero solo ${cumple7}/7 condiciones — ${faltanK.slice(0,3).join(', ')}`;
  }

  // ─── PASO 6: Ajustes finales ──────────────────────────────────────────────

  // Macro ROJO → bajar un nivel
  const COMPRAS = ['COMPRA_FUERTE', 'COMPRA', 'COMPRA_PARCIAL'];
  if (datos.macroEstado === 'ROJO' && COMPRAS.includes(senal)) {
    const prev = senal;
    if (senal === 'COMPRA_FUERTE') senal = 'COMPRA';
    else if (senal === 'COMPRA')   senal = 'COMPRA_PARCIAL';
    else                           senal = 'VIGILAR_PULLBACK';
    if (senal !== prev) razon = '🔴 Macro ROJO → ' + razon;
  }

  // Nasdaq débil + tech → bajar un nivel
  if (datos.nasdaqDebil && datos.isTech && COMPRAS.includes(senal)) {
    const prev = senal;
    if (senal === 'COMPRA_FUERTE') senal = 'COMPRA';
    else if (senal === 'COMPRA')   senal = 'COMPRA_PARCIAL';
    else                           senal = 'VIGILAR_PULLBACK';
    if (senal !== prev) razon = '📉 Nasdaq débil → ' + razon;
  }

  // RSC perdió liderazgo
  if (datos.rsc?.perdioLiderazgo) razon = '⚠️ PIERDE LIDERAZGO → ' + razon;

  return _resultado(datos.ticker, senal, razon, alertas, datos, regimen, fuerza, pullReal, stoch, cond7, cumple7);
}

// ─── Helper resultado ─────────────────────────────────────────────────────────

function _resultado(ticker, senal, razon, alertas, datos, regimen, fuerza, pullReal, stoch, cond7, cumple7) {
  return {
    ticker, senal, razon, alertas,
    cantidadAlertas: alertas.length,
    detalles: {
      precio:            datos.precio,
      regimen,
      fuerza,
      pullbackReal:      pullReal?.real ?? null,
      pullbackRetroceso: pullReal?.retroceso ?? null,
      pullbackVelasRojas:pullReal?.velasRojas ?? null,
      condiciones7:      cumple7 != null ? `${cumple7}/7` : null,
      cond7,
      stochZona:         stoch?.zona,
      stochGiro:         stoch?.giroValido,
      distEma200:        isValid(datos.ema200) ? pct(datos.precio, datos.ema200).toFixed(2) + '%' : 'N/D',
      distWMA20:         isValid(datos.wma20)  ? pct(datos.precio, datos.wma20).toFixed(2)  + '%' : 'N/D',
      distWMA50:         isValid(datos.wma50)  ? pct(datos.precio, datos.wma50).toFixed(2)  + '%' : 'N/D',
      mansfieldSemanal:  datos.mansfieldSemanal?.valor    ?? null,
      mansfieldPend:     datos.mansfieldSemanal?.pendiente ?? null,
      rscDiario:         datos.rsc?.valor ?? null,
      stochRsi:          datos.stochRsi,
      volumenRatio:      datos.ratioVolumen,
      pendienteEMA200:   datos.pendienteEMA200,
      macroEstado:       datos.macroEstado
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
  evaluarSPX,
  subirSenal,
  evaluarRegimen,
  evaluarFuerzaRelativa,
  evaluarStochRSIDetallado,
  verificarPullbackReal,
  evaluar7Condiciones,
  PRIORIDAD_SENAL
};
