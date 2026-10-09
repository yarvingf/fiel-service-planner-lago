import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { ParadaRuta, RutaCalculada } from '@/domain/ruta'

export const ID_FUENTE_RUTA = 'src-rutas'
export const ID_CAPA_RUTA_HALO = 'capa-ruta-halo'
export const ID_CAPA_RUTA_LINEAS = 'capa-ruta-lineas'
export const ID_CAPA_RUTA_FLECHAS = 'capa-ruta-flechas'
/** Cabecita brillante que recorre la ruta — solo en el modo "animado". */
export const ID_CAPA_RUTA_CABEZA = 'capa-ruta-cabeza'
export const ID_CAPA_RUTA_PARADAS = 'capa-ruta-paradas'
export const ID_CAPA_RUTA_ORDEN = 'capa-ruta-orden'
export const ID_CAPA_RUTA_MUELLE = 'capa-ruta-muelle'

export const COLOR_RUTA = '#ef4444'

const FC_VACIA: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Capas del trazado de ruta: rojo intenso con halo oscuro (legible sobre
 * satélite y vectorial), flechas `>` repetidas a lo largo de cada línea que
 * se orientan solas con el tramo (symbol-placement 'line'), puntos
 * numerados en cada parada y marcador especial en el muelle. La fuente
 * nace vacía — las capas no pintan nada hasta `dibujarRuta`.
 */
export function agregarCapasRuta(map: MaplibreMap): void {
  if (!map.getSource(ID_FUENTE_RUTA)) {
    // lineMetrics: true habilita ['line-progress'] — lo necesita el modo
    // "gradiente" y la cabecita animada (misma técnica que las líneas EF/MG).
    map.addSource(ID_FUENTE_RUTA, { type: 'geojson', data: FC_VACIA, lineMetrics: true })
  }

  // Halo oscuro bajo la línea: sobre satélite el rojo solo se diluye.
  if (!map.getLayer(ID_CAPA_RUTA_HALO)) {
    map.addLayer({
      id: ID_CAPA_RUTA_HALO,
      type: 'line',
      source: ID_FUENTE_RUTA,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': 'rgba(0,0,0,0.55)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 12, 5.5, 15, 8],
        'line-blur': 1.5,
      },
    })
  }
  if (!map.getLayer(ID_CAPA_RUTA_LINEAS)) {
    map.addLayer({
      id: ID_CAPA_RUTA_LINEAS,
      type: 'line',
      source: ID_FUENTE_RUTA,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': COLOR_RUTA,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 2.6, 15, 3.6],
        'line-opacity': 0.95,
      },
    })
  }
  // Cabecita animada (solo modo "animado"): banda angosta y brillante que
  // recorre la ruta muelle→última parada — estiloLineas.ts mueve su
  // line-gradient en el mismo intervalo que los guiones. Nace oculta; el
  // modo elegido la enciende. Va bajo las flechas para no taparlas.
  if (!map.getLayer(ID_CAPA_RUTA_CABEZA)) {
    map.addLayer({
      id: ID_CAPA_RUTA_CABEZA,
      type: 'line',
      source: ID_FUENTE_RUTA,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { visibility: 'none' },
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.2, 12, 5.2, 15, 7.2],
      },
    })
  }
  // Flechas de sentido: el glifo '>' (seguro en cualquier fuente del estilo)
  // se repite cada ~110px y MapLibre lo rota con el tramo.
  if (!map.getLayer(ID_CAPA_RUTA_FLECHAS)) {
    map.addLayer({
      id: ID_CAPA_RUTA_FLECHAS,
      type: 'symbol',
      source: ID_FUENTE_RUTA,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 110,
        'text-field': '>',
        'text-font': ['Noto Sans Bold'],
        'text-size': 15,
        'text-rotation-alignment': 'map',
        'text-allow-overlap': true,
        'text-ignore-placement': false,
      },
      paint: { 'text-color': '#fecaca' },
    })
  }
  if (!map.getLayer(ID_CAPA_RUTA_PARADAS)) {
    map.addLayer({
      id: ID_CAPA_RUTA_PARADAS,
      type: 'circle',
      source: ID_FUENTE_RUTA,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'esMuelle']]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 6, 15, 8],
        'circle-color': COLOR_RUTA,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.4,
      },
    })
  }
  // Número de parada (1, 2, 3…) junto al punto — clave para leer el orden.
  if (!map.getLayer(ID_CAPA_RUTA_ORDEN)) {
    map.addLayer({
      id: ID_CAPA_RUTA_ORDEN,
      type: 'symbol',
      source: ID_FUENTE_RUTA,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'esMuelle']]],
      layout: {
        'text-field': ['concat', ['to-string', ['get', 'orden']], ' ', ['get', 'codigo']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-offset': [0, -1.2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.6,
      },
    })
  }
  if (!map.getLayer(ID_CAPA_RUTA_MUELLE)) {
    map.addLayer({
      id: ID_CAPA_RUTA_MUELLE,
      type: 'symbol',
      source: ID_FUENTE_RUTA,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'esMuelle']],
      layout: {
        'text-field': '⚓',
        'text-size': 26,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#fbbf24' },
    })
  }
}

export interface RutaDibujo {
  cuadrillaId: string
  origen: ParadaRuta
  ruta: RutaCalculada
  cerrada: boolean
}

/**
 * Vuelca las rutas calculadas a la fuente: una LineString por cuadrilla
 * (vértices en orden de visita, con retorno al muelle si es cerrada) y un
 * Point por parada con su número de orden + el muelle.
 */
export function dibujarRuta(map: MaplibreMap, rutas: readonly RutaDibujo[]): void {
  const src = map.getSource(ID_FUENTE_RUTA) as GeoJSONSource | undefined
  if (!src) return

  const features: FeatureCollection['features'] = []
  const muellesVistos = new Set<string>()
  for (const { origen, ruta, cerrada } of rutas) {
    const coords = [[origen.lon, origen.lat], ...ruta.orden.map((p) => [p.lon, p.lat])]
    if (cerrada && ruta.orden.length > 0) coords.push([origen.lon, origen.lat])
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      })
    }
    ruta.orden.forEach((p, idx) => {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { orden: idx + 1, codigo: p.codigo },
      })
    })
    // Un solo marcador de muelle aunque varias cuadrillas partan de él.
    if (!muellesVistos.has(origen.codigo)) {
      muellesVistos.add(origen.codigo)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [origen.lon, origen.lat] },
        properties: { esMuelle: true },
      })
    }
  }
  src.setData({ type: 'FeatureCollection', features })
}

/** Quita el trazado (fecha cambiada, botón "Quitar", desmontaje). */
export function limpiarRuta(map: MaplibreMap): void {
  const src = map.getSource(ID_FUENTE_RUTA) as GeoJSONSource | undefined
  src?.setData(FC_VACIA)
}
