import type { ExpressionSpecification, Map as MaplibreMap } from 'maplibre-gl'
import {
  ID_CAPA_LINEAS,
  ID_CAPA_LINEAS_CABEZA,
} from './capasMarcadores'
import {
  ID_CAPA_RUTA_LINEAS,
  ID_CAPA_RUTA_CABEZA,
} from './capasRuta'
import type { Filtros } from '@/state/filtrosStore'

/**
 * Dos técnicas para indicar el sentido instalación→pozo en la línea de
 * asociación, ninguna recalcula geometría ni redibuja nada por nuestra
 * cuenta:
 *
 * - 'gradiente': capas por tipo EF/MG con `line-gradient` fijo horneado en
 *   el paint (capasMarcadores.ts) — line-gradient no admite expresiones con
 *   ['get'], por eso una capa por color. Estático, cero costo por frame.
 * - 'animado': cicla `line-dasharray` cada ~60ms sobre la capa principal (la
 *   técnica estándar de Mapbox/MapLibre para simular "marcha de guiones") +
 *   la "cabecita" brillante que recorre la línea con un line-gradient blanco
 *   móvil (colores literales — también válido).
 */

/** Secuencia de patrones de guiones (técnica clásica de Mapbox "animate a line") — cada paso avanza la fase. */
const SECUENCIA_DASH: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
]

/**
 * "Cabecita" que recorre la línea junto al guión: una banda angosta y
 * brillante ubicada en `pos` (0..1 de avance instalación→pozo), calculada
 * con la misma ['line-progress'] que el gradiente — sin geometría nueva.
 * Se mantiene lejos de los extremos (CABEZA_MIN/MAX) para que los topes del
 * `interpolate` sean siempre estrictamente crecientes.
 */
const CABEZA_MIN = 0.04
const CABEZA_MAX = 0.97
const CABEZA_PASO = 0.015

function gradienteCabeza(pos: number): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['line-progress'],
    pos - 0.03, 'rgba(255,255,255,0)',
    pos, 'rgba(255,255,255,0.95)',
    pos + 0.015, 'rgba(255,255,255,0)',
  ]
}

/**
 * Gradiente del modo estático sobre las líneas de ruta: progreso 0 = muelle
 * (casi transparente), 1 = última parada (rojo pleno). Las rutas son siempre
 * rojas — a diferencia de EF/MG no hacen falta capas por tipo.
 */
const gradienteRuta: ExpressionSpecification = [
  'interpolate', ['linear'], ['line-progress'],
  0, 'rgba(239,68,68,0.08)', 1, 'rgba(239,68,68,0.95)',
]

let intervalo: ReturnType<typeof setInterval> | null = null

function detenerAnimacion(): void {
  if (intervalo !== null) {
    clearInterval(intervalo)
    intervalo = null
  }
}

function iniciarAnimacion(map: MaplibreMap): void {
  if (intervalo !== null) return
  let paso = 0
  let posicionCabeza = CABEZA_MIN
  intervalo = setInterval(() => {
    if (!map.getLayer(ID_CAPA_LINEAS)) return
    paso = (paso + 1) % SECUENCIA_DASH.length
    const patron = SECUENCIA_DASH[paso]
    map.setPaintProperty(ID_CAPA_LINEAS, 'line-dasharray', patron)
    // El mismo disparador anima los guiones de la ruta — comparten la marcha.
    if (map.getLayer(ID_CAPA_RUTA_LINEAS)) {
      map.setPaintProperty(ID_CAPA_RUTA_LINEAS, 'line-dasharray', patron)
    }

    posicionCabeza += CABEZA_PASO
    if (posicionCabeza > CABEZA_MAX) posicionCabeza = CABEZA_MIN
    if (map.getLayer(ID_CAPA_LINEAS_CABEZA)) {
      map.setPaintProperty(ID_CAPA_LINEAS_CABEZA, 'line-gradient', gradienteCabeza(posicionCabeza))
    }
    if (map.getLayer(ID_CAPA_RUTA_CABEZA)) {
      map.setPaintProperty(ID_CAPA_RUTA_CABEZA, 'line-gradient', gradienteCabeza(posicionCabeza))
    }
  }, 60)
}

/**
 * Aplica la técnica elegida. La visibilidad de cada capa por modo la decide
 * `aplicarFiltros` (filtros.ts); aquí solo se enciende/apaga la animación.
 * Idempotente.
 */
export function aplicarEstiloLineas(map: MaplibreMap, estilo: Filtros['estiloLineas']): void {
  if (!map.getLayer(ID_CAPA_LINEAS)) return
  if (estilo === 'gradiente') {
    detenerAnimacion()
    map.setPaintProperty(ID_CAPA_LINEAS, 'line-dasharray', undefined)
  } else {
    iniciarAnimacion(map)
  }
}

/** Detiene el intervalo de animación (líneas ocultas, cambio de fecha, desmontaje). */
export function detenerEstiloLineas(): void {
  detenerAnimacion()
}

/**
 * La ruta comparte la técnica elegida en Filtros → Estilo de líneas, pero es
 * independiente del interruptor "mostrar líneas de asociación": el usuario
 * la traza a propósito, así que se estiliza aunque las EF/MG estén ocultas.
 *
 * - 'gradiente': line-gradient rojo horneado (muelle transparente → última
 *   parada plena) y se apagan guiones y cabecita.
 * - 'animado': quita el gradiente (null = vuelve el line-color rojo sólido),
 *   enciende la cabecita y arranca el intervalo compartido de guiones.
 */
export function aplicarEstiloRuta(map: MaplibreMap, estilo: Filtros['estiloLineas']): void {
  if (!map.getLayer(ID_CAPA_RUTA_LINEAS)) return
  const cabeza = map.getLayer(ID_CAPA_RUTA_CABEZA)
  if (estilo === 'gradiente') {
    map.setPaintProperty(ID_CAPA_RUTA_LINEAS, 'line-dasharray', undefined)
    map.setPaintProperty(ID_CAPA_RUTA_LINEAS, 'line-gradient', gradienteRuta)
    if (cabeza) map.setLayoutProperty(ID_CAPA_RUTA_CABEZA, 'visibility', 'none')
    // Si las EF/MG están ocultas y esta era la única animación viva, se apaga.
    detenerAnimacion()
  } else {
    map.setPaintProperty(ID_CAPA_RUTA_LINEAS, 'line-gradient', undefined)
    if (cabeza) map.setLayoutProperty(ID_CAPA_RUTA_CABEZA, 'visibility', 'visible')
    iniciarAnimacion(map)
  }
}
