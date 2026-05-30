// ============================================================================
// PORTFOLIO MONITOR - MOTOR DE CONFLUENCIA v4.0
// Sistema: Fuerza Relativa + Régimen + Pullback Confirmado (5 condiciones)
// ============================================================================

'use strict';

const pct     = (a, b) => (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) ? 0 : ((a - b) / b) * 100;
const isValid = v => Number.isFinite(v) && v > 0;

// ============================================================================
// RSC MANSFIELD DIARIO (se mantiene para compatibilidad)
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
  if (!v) return { esVerde: false, conCuerpo: false, ratio: 0 };
  const { open = 0, close = 0, high = 0, low = 0 } = v;
  const esVerde = close > open;
  const rango   = high - low;
  const cuerpo  = Math.abs(close - open);
  const ratio   = rango > 0 ? cuerpo / rango : 0;
  return { esVerde, conCuerpo: esVerde && ratio > 0.4, ratio };
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
  if (velas.length >= 3 && esThreeWhiteSoldiers(velas)) return { patron: 'THREE_WHITE_SOLDIERS', icono: '🕯️', nombre: 'Tres Soldados' };
  if (velas.length >= 3 && esMorningStar(velas))         return { patron: 'MORNING_STAR',        icono: '🌟', nombre: 'Estrella Matutina' };
  if (velas.length >= 2 && esBullishEngulfing(velas))    return { patron: 'BULLISH_ENGULFING',   icono: '🕯️', nombre: 'Envolvente Alcista' };
  if (esHammer(velas))                                    return { patron: 'HAMMER',              icono: '🔨', nombre: 'Martillo' };
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
// NUEVO v4.0: RÉGIMEN DE MERCADO
// ============================================================================

function evaluarRegimen(datos) {
  const { precio, ema200, wma20, wma50, pendienteEMA200 } = datos;
  if (!isValid(precio) || !isValid(ema200)) return 'DESCONOCIDO';
  if (precio < ema200) return 'BAJISTA';

  const p    = pendienteEMA200 || 0;
  const absP = Math.abs(p);

  if (p > 0 && isValid(wma20) && isValid(wma50) && precio > wma20 && wma20 > wma50)
    return 'ALCISTA_FUERTE';
  if (absP < 0.1)
    return 'NEUTRAL';
  if (p >= 0)
    return 'ALCISTA_ACEPTABLE';
  // precio > EMA200 pero pendiente negativa — todavía aceptable si no muy extendida
  return 'ALCISTA_ACEPTABLE';
}

// ============================================================================
// NUEVO v4.0: FUERZA RELATIVA (semanal preferido, diario como fallback)
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
// NUEVO v4.0: PULLBACK CONFIRMADO (5 condiciones simultáneas)
// ============================================================================

function evaluarPullbackConfirmado(datos) {
  const { precio, wma20, wma50, wma100, stochRsi, stochRsiPrev, ratioVolumen, velas } = datos;

  // PC1: En zona de soporte dinámico (WMA20 ±% o WMA50 ±%)
  const enW20 = isValid(wma20) && precio >= wma20 * 0.95 && precio <= wma20 * 1.02;
  const enW50 = isValid(wma50) && precio >= wma50 * 0.97 && precio <= wma50 * 1.03;
  const pc1   = enW20 || enW50;

  // PC2: Estructura alcista conservada
  const pc2 = isValid(wma20) && isValid(wma50) && isValid(wma100)
    && wma20 > wma50 && precio > wma100;

  // PC3: Vela de intención válida (verde, cuerpo ≥40%, cierre en 60% superior, supera apertura anterior)
  let pc3 = false;
  const vela  = velas?.[velas.length - 1];
  const vela2 = velas?.[velas.length - 2];
  if (vela && vela2) {
    const range   = vela.high - vela.low;
    const body    = Math.abs(vela.close - vela.open);
    const ratioC  = range > 0 ? body / range : 0;
    const cierreAlto = range > 0 ? (vela.close - vela.low) / range >= 0.6 : false;
    pc3 = vela.close > vela.open && ratioC >= 0.4 && cierreAlto && vela.close > vela2.open;
  }

  // PC4: StochRSI con giro alcista válido (subiendo, 20-80, no sobrecompra >80)
  let pc4 = false;
  if (stochRsi != null) {
    const subiendo = stochRsiPrev != null ? stochRsi > stochRsiPrev : true;
    pc4 = subiendo && stochRsi >= 20 && stochRsi <= 80;
  }

  // PC5: Volumen mínimo (≥80% del promedio)
  const pc5 = (ratioVolumen ?? 1) >= 0.8;

  const condiciones = { pc1, pc2, pc3, pc4, pc5 };
  const cumplidas   = Object.values(condiciones).filter(Boolean).length;

  return { confirmado: cumplidas >= 5, parcial: cumplidas >= 3, cumplidas, condiciones, enZona: pc1 };
}

// ============================================================================
// NUEVO v4.0: STOCHRSI DETALLADO
// ============================================================================

function evaluarStochRSIDetallado(stochRsi, stochRsiPrev) {
  if (stochRsi == null) return { zona: 'DESCONOCIDO', giroValido: false, giroInvalido: false, valor: null };
  const subiendo     = stochRsiPrev != null ? stochRsi > stochRsiPrev : null;
  const giroValido   = subiendo === true && stochRsi < 75;
  const giroInvalido = stochRsi > 80;
  let zona;
  if (stochRsi > 80)       zona = 'ZONA_PELIGROSA';
  else if (stochRsi >= 40) zona = 'ZONA_OPTIMA';
  else if (stochRsi >= 20) zona = 'ZONA_ACEPTABLE';
  else                     zona = 'ZONA_BAJA';
  return { zona, giroValido, giroInvalido, subiendo, valor: stochRsi };
}

// ============================================================================
// HELPER: SUBIR SEÑAL
// ============================================================================

function subirSenal(senal) {
  const up = { MANTENER:'VIGILAR_PULLBACK', VIGILAR_PULLBACK:'COMPRA_PARCIAL', VIGILAR_REBOTE:'COMPRA_PARCIAL', COMPRA_PARCIAL:'COMPRA', COMPRA:'COMPRA_FUERTE' };
  return up[senal] || senal;
}

// ============================================================================
// HELPER: CONSTRUIR DETALLES
// ============================================================================

function buildDetalles(datos, regimen, fuerza, pullback, stoch) {
  return {
    precio:              datos.precio,
    regimen,
    fuerza,
    pullbackCumplidas:   pullback?.cumplidas ?? null,
    pullbackCondiciones: pullback?.condiciones ?? null,
    stochZona:           stoch?.zona,
    stochGiro:           stoch?.giroValido,
    distEma200:          isValid(datos.ema200) ? pct(datos.precio, datos.ema200).toFixed(2) + '%' : 'N/D',
    distWMA20:           isValid(datos.wma20)  ? pct(datos.precio, datos.wma20).toFixed(2)  + '%' : 'N/D',
    distWMA50:           isValid(datos.wma50)  ? pct(datos.precio, datos.wma50).toFixed(2)  + '%' : 'N/D',
    mansfieldSemanal:    datos.mansfieldSemanal?.valor    ?? null,
    mansfieldPendiente:  datos.mansfieldSemanal?.pendiente ?? null,
    rscDiario:           datos.rsc?.valor ?? null,
    stochRsi:            datos.stochRsi,
    volumenRatio:        datos.ratioVolumen,
    pendienteEMA200:     datos.pendienteEMA200,
    macroEstado:         datos.macroEstado
  };
}

// ============================================================================
// FUNCIÓN PRINCIPAL — EVALUAR ACTIVO v4.0
// ============================================================================

function evaluarActivo(datos) {
  if (!isValid(datos.precio) || !isValid(datos.ema200)) {
    return { ticker: datos.ticker || 'DESCONOCIDO', senal: 'SIN_DATOS', alertas: [], detalles: null };
  }

  // ── VETO EMA200 ──────────────────────────────────────────────────────────
  if (datos.precio < datos.ema200) {
    const urgente = (datos.pendienteEMA200 || 0) < -0.05;
    return {
      ticker:  datos.ticker,
      senal:   'VENDER',
      razon:   urgente
        ? '⚠️ Precio bajo EMA200 con pendiente negativa — salida urgente'
        : 'Precio bajo EMA200 — fuera de tendencia',
      alertas:    [],
      cantidadAlertas: 0,
      detalles: buildDetalles(datos, 'BAJISTA', 'DEBIL', null, null)
    };
  }

  // ── EVALUACIONES ─────────────────────────────────────────────────────────
  const regimen  = evaluarRegimen(datos);
  const fuerza   = evaluarFuerzaRelativa(datos);
  const pullback = evaluarPullbackConfirmado(datos);
  const stoch    = evaluarStochRSIDetallado(datos.stochRsi, datos.stochRsiPrev);
  const spx      = evaluarSPX(datos.spxPrecio, datos.spxEma20);
  const patron   = detectarPatronesVela(datos.velas);
  const volumen  = evaluarVolumen(datos.velas?.[datos.velas.length-1], datos.velas);
  const vela     = evaluarVela(datos.velas?.[datos.velas.length-1]);

  // Alerta temprana: Mansfield girando al alza (informativa, nunca genera compra)
  const alertaMansfield = (datos.mansfieldSemanal?.pendiente ?? 0) > 0
    && (datos.mansfieldSemanal?.mrs_anterior ?? 0) <= 0;

  // ── ALERTAS (badges) ─────────────────────────────────────────────────────
  const alertas = [];
  if (pullback.enZona)
    alertas.push({ icono: '🎯', tipo: 'PULLBACK_ZONA',   mensaje: `Zona soporte (${pullback.cumplidas}/5 cond.)` });
  if (stoch.zona === 'ZONA_OPTIMA' && stoch.giroValido)
    alertas.push({ icono: '📊', tipo: 'STOCH_OPTIMO',    mensaje: `StochRSI ${stoch.valor?.toFixed(1)} óptimo ↑` });
  else if (stoch.zona === 'ZONA_ACEPTABLE' && stoch.giroValido)
    alertas.push({ icono: '📊', tipo: 'STOCH_ACEPTABLE', mensaje: `StochRSI ${stoch.valor?.toFixed(1)} rebote ↑` });
  if (spx.favorable)
    alertas.push({ icono: '📈', tipo: 'SPX_FAVORABLE',   mensaje: `SPX favorable (${spx.distancia?.toFixed(2)}%)` });
  if (vela.esVerde)
    alertas.push({ icono: vela.conCuerpo ? '🟢' : '🟩',  tipo: 'VELA_VERDE', mensaje: vela.conCuerpo ? 'Vela verde cuerpo' : 'Vela verde' });
  if (volumen.superior)
    alertas.push({ icono: volumen.muyAlto ? '🔊' : '🔉', tipo: 'VOLUMEN', mensaje: `Vol ${volumen.ratio}x` });
  if (patron)
    alertas.push({ icono: patron.icono, tipo: patron.patron, mensaje: patron.nombre });
  if ((fuerza === 'LIDERAZGO_FUERTE' || fuerza === 'LIDERAZGO_MODERADO') && (datos.rsc?.valor ?? 0) > 0)
    alertas.push({ icono: '💪', tipo: 'RSC_FUERTE', mensaje: `RSC líder +${(datos.mansfieldSemanal?.valor ?? datos.rsc?.valor ?? 0).toFixed(1)}` });
  if (alertaMansfield)
    alertas.push({ icono: '🔔', tipo: 'ALERTA_MANSFIELD', mensaje: 'Mansfield girando ↑ (monitorizar)' });
  if (regimen === 'ALCISTA_FUERTE')
    alertas.push({ icono: '🚀', tipo: 'REGIMEN_FUERTE', mensaje: 'Régimen alcista fuerte' });

  // ── SEÑAL ────────────────────────────────────────────────────────────────
  let senal = 'MANTENER';
  let razon = '';

  // Régimen BAJISTA (precio < EMA200 ya vetado arriba, pero por si acaso)
  if (regimen === 'BAJISTA') {
    senal = 'VENDER'; razon = 'Régimen bajista';
  }
  // Mansfield DÉBIL: nunca comprar, máximo VIGILAR
  else if (fuerza === 'DEBIL') {
    if (pullback.enZona) {
      senal = 'VIGILAR_PULLBACK';
      razon = `Mansfield débil — en zona pero sin liderazgo (${pullback.cumplidas}/5)`;
    } else {
      senal = 'MANTENER';
      const mrsVal = (datos.mansfieldSemanal?.valor ?? datos.rsc?.valor ?? null);
      razon = `Mansfield ${mrsVal !== null ? mrsVal.toFixed(2) : 'N/D'} — acción sin liderazgo`;
    }
    if (alertaMansfield) razon = '🔔 Mansfield girando → ' + razon;
  }
  // StochRSI sobrecompra: no entrar
  else if (stoch.giroInvalido) {
    senal = pullback.enZona ? 'VIGILAR_PULLBACK' : 'MANTENER';
    razon = `StochRSI sobrecompra (${stoch.valor?.toFixed(1)}) — esperar corrección`;
  }
  // Pullback CONFIRMADO (5/5)
  else if (pullback.confirmado) {
    if (regimen === 'ALCISTA_FUERTE' && fuerza === 'LIDERAZGO_FUERTE') {
      senal = 'COMPRA_FUERTE';
      razon = 'Confluencia máxima: pullback 5/5 + régimen fuerte + liderazgo fuerte';
    } else if (regimen === 'ALCISTA_FUERTE' || fuerza === 'LIDERAZGO_FUERTE') {
      senal = 'COMPRA';
      razon = `Pullback confirmado 5/5 — régimen ${regimen} / fuerza ${fuerza}`;
    } else {
      senal = 'COMPRA';
      razon = 'Pullback confirmado (5/5)';
    }
  }
  // Pullback PARCIAL (3-4/5)
  else if (pullback.parcial) {
    if (regimen === 'ALCISTA_FUERTE' && fuerza === 'LIDERAZGO_FUERTE') {
      senal = 'COMPRA';
      razon = `Pullback parcial ${pullback.cumplidas}/5 + confluencia fuerte`;
    } else {
      senal = 'COMPRA_PARCIAL';
      razon = `Pullback parcial ${pullback.cumplidas}/5 — falta confirmación`;
    }
  }
  // En zona (PC1) sin más condiciones
  else if (pullback.enZona) {
    senal = 'VIGILAR_PULLBACK';
    razon = `En zona soporte — ${pullback.cumplidas}/5 condiciones cumplidas`;
  }
  // Extendido bajo WMA50
  else if (isValid(datos.wma50) && datos.precio < datos.wma50 * 0.97) {
    senal = 'VIGILAR_REBOTE';
    razon = `${pct(datos.precio, datos.wma50).toFixed(2)}% bajo WMA50 — esperar rebote`;
  }
  else {
    senal = 'MANTENER';
    razon = 'En tendencia, fuera de zona de entrada';
  }

  // ── AJUSTES FINALES ───────────────────────────────────────────────────────

  // Régimen NEUTRAL → cap en COMPRA_PARCIAL
  if (regimen === 'NEUTRAL' && ['COMPRA_FUERTE', 'COMPRA'].includes(senal)) {
    senal = 'COMPRA_PARCIAL';
    razon = '⚠️ Régimen neutral → ' + razon;
  }

  // Macro ROJO → bajar señal un nivel
  const COMPRAS = ['COMPRA_FUERTE', 'COMPRA', 'COMPRA_PARCIAL'];
  if (datos.macroEstado === 'ROJO' && COMPRAS.includes(senal)) {
    const prev = senal;
    if (senal === 'COMPRA_FUERTE') senal = 'COMPRA';
    else if (senal === 'COMPRA')   senal = 'COMPRA_PARCIAL';
    else                           senal = 'VIGILAR_PULLBACK';
    if (senal !== prev) razon = '🔴 Macro ROJO → ' + razon;
  }

  // Nasdaq débil + tech → bajar señal un nivel
  if (datos.nasdaqDebil && datos.isTech && COMPRAS.includes(senal)) {
    const prev = senal;
    if (senal === 'COMPRA_FUERTE') senal = 'COMPRA';
    else if (senal === 'COMPRA')   senal = 'COMPRA_PARCIAL';
    else                           senal = 'VIGILAR_PULLBACK';
    if (senal !== prev) razon = '📉 Nasdaq débil → ' + razon;
  }

  // RSC perdió liderazgo
  if (datos.rsc?.perdioLiderazgo) razon = '⚠️ PIERDE LIDERAZGO → ' + razon;

  return {
    ticker: datos.ticker,
    senal, razon, alertas,
    cantidadAlertas: alertas.length,
    detalles: buildDetalles(datos, regimen, fuerza, pullback, stoch)
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
  evaluarPullbackConfirmado,
  evaluarStochRSIDetallado,
  PRIORIDAD_SENAL
};
