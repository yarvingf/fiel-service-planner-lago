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

/**
 * Capa satelital HD: Esri World Imagery (imagery Maxar/aéreo, ~0.3-1 m/px en
 * la costa del Lago de Maracaibo vs. los ~10 m/px de Sentinel-2). Endpoint
 * público REST de ArcGIS Online — uso libre con atribución visible; volúmenes
 * altos piden cuenta ArcGIS según sus ToS, pero para uso interno/regional es
 * práctica estándar. maxzoom 19: encima de eso MapLibre remuestrea el tile.
 */
const SATELITE_HD_TILES_URL =
  import.meta.env.VITE_SATELLITE_HD_TILES_URL ??
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const SATELITE_HD_ATRIBUCION = 'Esri, Maxar, Earthstar Geographics'

export const FUENTE_SATELITE_HD: RasterSourceSpecification = {
  type: 'raster',
  tiles: [SATELITE_HD_TILES_URL],
  tileSize: 256,
  attribution: SATELITE_HD_ATRIBUCION,
  maxzoom: 19,
}

export const ID_FUENTE_SATELITE = 'satelite'
export const ID_CAPA_SATELITE = 'satelite-capa'
export const ID_FUENTE_SATELITE_HD = 'satelite-hd'
export const ID_CAPA_SATELITE_HD = 'satelite-hd-capa'

/** Modos de la capa base: vectorial oscuro, satélite Sentinel-2 o satélite HD (Esri). */
export type ModoBaseMapa = 'vectorial' | 'satelital' | 'satelitalHd'

/**
 * Agrega las fuentes/capas satelitales al estilo ya cargado (vectorial),
 * ocultas por defecto. Se insertan debajo de la primera capa del estilo para
 * que, cuando se muestren, queden como fondo y las etiquetas/vías del
 * vectorial no se vean duplicadas encima (esas se ocultan aparte al activar
 * cualquier modo satélite).
 */
export function agregarFuenteSatelite(map: MaplibreMap): void {
  const primeraCapa = map.getStyle().layers?.[0]?.id
  for (const [fuente, capa, spec] of [
    [ID_FUENTE_SATELITE, ID_CAPA_SATELITE, FUENTE_SATELITE],
    [ID_FUENTE_SATELITE_HD, ID_CAPA_SATELITE_HD, FUENTE_SATELITE_HD],
  ] as const) {
    if (map.getSource(fuente)) continue
    map.addSource(fuente, spec)
    map.addLayer(
      { id: capa, type: 'raster', source: fuente, layout: { visibility: 'none' } },
      primeraCapa,
    )
  }
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
      .filter((id) => id !== ID_CAPA_SATELITE && id !== ID_CAPA_SATELITE_HD)
  }
  // Un satélite visible a la vez; las capas del estilo vectorial se ocultan
  // en cualquiera de los dos modos satelitales.
  const esSatelite = modo !== 'vectorial'
  for (const [capa, activoEn] of [
    [ID_CAPA_SATELITE, 'satelital'],
    [ID_CAPA_SATELITE_HD, 'satelitalHd'],
  ] as const) {
    if (map.getLayer(capa)) {
      map.setLayoutProperty(capa, 'visibility', modo === activoEn ? 'visible' : 'none')
    }
  }
  for (const id of capasEstiloBase) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', esSatelite ? 'none' : 'visible')
    }
  }
}

/** Referencia de tipo para evitar importar el módulo completo solo por el tipo Map. */
export type { StyleSpecification }
