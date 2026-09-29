import type { Map as MaplibreMap, RasterSourceSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * Estilo vectorial: OpenFreeMap (instancia pública, sin API key, sin límite de
 * uso). Ver https://openfreemap.org — financiado por donaciones; si algún día
 * deja de estar disponible, la migración es cambiar esta URL por un estilo
 * autohospedado (p. ej. Protomaps con un .pmtiles de la región).
 */
export const ESTILO_VECTORIAL_URL = 'https://tiles.openfreemap.org/styles/liberty'

/**
 * Capa satelital: Sentinel-2 cloudless de EOX (tiles.maps.eox.at).
 *
 * ADVERTENCIA DE LICENCIA (importante antes de producción):
 * - El mosaico `s2cloudless` (el más reciente, usado aquí) es CC BY-NC-SA:
 *   NO permite uso comercial. El mosaico 2016 que sí era CC BY ya no existe
 *   en el endpoint público de EOX.
 * - Antes de producción: usar un proveedor con licencia comercial (licencia
 *   EOxCloudless, Sentinel Hub con API key, MapTiler, tiles propios, etc.)
 *   mediante VITE_SATELLITE_TILES_URL.
 * - El servicio público aplica rate-limiting bajo carga alta.
 * Ver: https://cloudless.eox.at/license-non-commercial
 */
const SATELITE_TILES_URL =
  import.meta.env.VITE_SATELLITE_TILES_URL ??
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'

const SATELITE_ATRIBUCION =
  'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)'

export const FUENTE_SATELITE: RasterSourceSpecification = {
  type: 'raster',
  tiles: [SATELITE_TILES_URL],
  tileSize: 256,
  attribution: SATELITE_ATRIBUCION,
  maxzoom: 14,
}

export const ID_FUENTE_SATELITE = 'satelite'
export const ID_CAPA_SATELITE = 'satelite-capa'

/**
 * Agrega la fuente/capa satelital al estilo ya cargado (vectorial), oculta por
 * defecto. Se inserta debajo de la primera capa del estilo para que, cuando
 * se muestre, quede como fondo y las etiquetas/vías del vectorial no se vean
 * duplicadas encima (esas se ocultan aparte al activar el satélite).
 */
export function agregarFuenteSatelite(map: MaplibreMap): void {
  if (map.getSource(ID_FUENTE_SATELITE)) return
  map.addSource(ID_FUENTE_SATELITE, FUENTE_SATELITE)
  const primeraCapa = map.getStyle().layers?.[0]?.id
  map.addLayer(
    {
      id: ID_CAPA_SATELITE,
      type: 'raster',
      source: ID_FUENTE_SATELITE,
      layout: { visibility: 'none' },
    },
    primeraCapa,
  )
}

// IDs de TODAS las capas del estilo base (Liberty) capturadas antes de que
// agreguemos las propias (satélite + pozos/instalaciones). Bajo satélite se
// ocultan todas: si solo se ocultara el fondo, los íconos de puntos de interés
// de OpenStreetMap (gasolineras, plantas industriales reales, etc.) seguirían
// visibles encima de la imagen y se confunden con nuestras instalaciones.
let capasEstiloBase: string[] | null = null

/**
 * Quita del estilo remoto las capas de escudos de autopista (Liberty trae las
 * de EE.UU./Europa: referencian sprites que el tileset de la región no tiene →
 * warnings en consola cada vez que el sprite se resuelve). Son irrelevantes en
 * el lago; hay que llamarlo antes de la primera `aplicarModoBase` para que las
 * capas borradas no queden en `capasEstiloBase` ni reaparezcan en modo satélite.
 */
export function limpiarCapasIrrelevantes(map: MaplibreMap): void {
  for (const capa of map.getStyle().layers ?? []) {
    if (/highway-shield|road_.*shield|shield/i.test(capa.id)) {
      try {
        map.removeLayer(capa.id)
      } catch {
        // Capa ya removida o dependencia del estilo — ignorar.
      }
    }
  }
}

export function aplicarModoBase(map: MaplibreMap, modo: 'vectorial' | 'satelital'): void {
  if (capasEstiloBase === null) {
    capasEstiloBase = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id !== ID_CAPA_SATELITE)
  }
  const visible = modo === 'satelital' ? 'visible' : 'none'
  if (map.getLayer(ID_CAPA_SATELITE)) {
    map.setLayoutProperty(ID_CAPA_SATELITE, 'visibility', visible)
  }
  for (const id of capasEstiloBase) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', modo === 'satelital' ? 'none' : 'visible')
    }
  }
}

/** Referencia de tipo para evitar importar el módulo completo solo por el tipo Map. */
export type { StyleSpecification }
