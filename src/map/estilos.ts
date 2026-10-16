import type { Map as MaplibreMap, RasterSourceSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * Estilo vectorial: OpenFreeMap (instancia pública, sin API key, sin límite de
 * uso). Ver https://openfreemap.org — financiado por donaciones; si algún día
 * deja de estar disponible, la migración es cambiar esta URL por un estilo
 * autohospedado (p. ej. Protomaps con un .pmtiles de la región).
 */
export const ESTILO_VECTORIAL_URL = 'https://tiles.openfreemap.org/styles/dark'

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
 * Overlay de referencia (calles + etiquetas) para encimar sobre el satélite:
 * los "reference layers" públicos de Esri — World Transportation trae las
 * vías y Boundaries & Places las etiquetas/nombres. Tiles pequeños,
 * transparentes, pensados exactamente para el modo híbrido. Sin key, con
 * atribución visible cuando la capa está activa.
 */
const REF_CALLES_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
const REF_ETIQUETAS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const REF_ATRIBUCION = 'Esri'

export const ID_CAPA_REF_CALLES = 'ref-calles'
export const ID_CAPA_REF_ETIQUETAS = 'ref-etiquetas'

const FUENTES_REF: [string, string, RasterSourceSpecification][] = [
  ['ref-calles-src', ID_CAPA_REF_CALLES, { type: 'raster', tiles: [REF_CALLES_URL], tileSize: 256, attribution: REF_ATRIBUCION, maxzoom: 19 }],
  ['ref-etiquetas-src', ID_CAPA_REF_ETIQUETAS, { type: 'raster', tiles: [REF_ETIQUETAS_URL], tileSize: 256, attribution: REF_ATRIBUCION, maxzoom: 19 }],
]

/** Modos de la capa base: vectorial oscuro o satélite Sentinel-2. */
export type ModoBaseMapa = 'vectorial' | 'satelital'

/**
 * Agrega la fuente/capa satelital (oculta, debajo de la primera capa del
 * estilo para servir de fondo) y las capas de referencia calles/etiquetas
 * (ocultas, al tope — los marcadores se agregan después y quedan por encima).
 */
export function agregarFuenteSatelite(map: MaplibreMap): void {
  if (!map.getSource(ID_FUENTE_SATELITE)) {
    map.addSource(ID_FUENTE_SATELITE, FUENTE_SATELITE)
    const primeraCapa = map.getStyle().layers?.[0]?.id
    map.addLayer(
      { id: ID_CAPA_SATELITE, type: 'raster', source: ID_FUENTE_SATELITE, layout: { visibility: 'none' } },
      primeraCapa,
    )
  }
  for (const [fuente, capa, spec] of FUENTES_REF) {
    if (map.getSource(fuente)) continue
    map.addSource(fuente, spec)
    map.addLayer({ id: capa, type: 'raster', source: fuente, layout: { visibility: 'none' } })
  }
}

/** Enciende/apaga el overlay de calles+etiquetas sobre el satélite. */
export function aplicarCapaCalles(map: MaplibreMap, visible: boolean): void {
  const v = visible ? 'visible' : 'none'
  if (map.getLayer(ID_CAPA_REF_CALLES)) map.setLayoutProperty(ID_CAPA_REF_CALLES, 'visibility', v)
  if (map.getLayer(ID_CAPA_REF_ETIQUETAS)) map.setLayoutProperty(ID_CAPA_REF_ETIQUETAS, 'visibility', v)
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

export function aplicarModoBase(map: MaplibreMap, modo: ModoBaseMapa): void {
  if (capasEstiloBase === null) {
    capasEstiloBase = (map.getStyle().layers ?? [])
      .map((l) => l.id)
      .filter((id) => id !== ID_CAPA_SATELITE && id !== ID_CAPA_REF_CALLES && id !== ID_CAPA_REF_ETIQUETAS)
  }
  // El satélite se ve solo en su modo; las capas del estilo vectorial se
  // ocultan mientras (la referencia calles/etiquetas se maneja aparte).
  const esSatelite = modo === 'satelital'
  if (map.getLayer(ID_CAPA_SATELITE)) {
    map.setLayoutProperty(ID_CAPA_SATELITE, 'visibility', esSatelite ? 'visible' : 'none')
  }
  for (const id of capasEstiloBase) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', esSatelite ? 'none' : 'visible')
    }
  }
}

/** Referencia de tipo para evitar importar el módulo completo solo por el tipo Map. */
export type { StyleSpecification }
