import { TerraDraw, TerraDrawRectangleMode, TerraDrawFreehandMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { Map as MaplibreMap, PointLike } from 'maplibre-gl'
import { ID_CAPA_POZOS, ID_CAPA_INSTALACIONES } from './capasMarcadores'
import { useAsignacionesStore, capturaPermite, type IdObjetivo } from '@/state/asignacionesStore'

let draw: TerraDraw | null = null

/**
 * Convierte el polígono dibujado en una caja de consulta en píxeles y extrae
 * los objetivos (pozos + instalaciones) dentro, por id.
 */
function objetivosEnPoligono(map: MaplibreMap, coords: number[][]): IdObjetivo[] {
  const puntos = coords.map(([lng, lat]) => map.project([lng, lat]))
  const xs = puntos.map((p) => p.x)
  const ys = puntos.map((p) => p.y)
  const caja: [PointLike, PointLike] = [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ]
  const features = map.queryRenderedFeatures(caja, {
    layers: [ID_CAPA_POZOS, ID_CAPA_INSTALACIONES],
  })
  const captura = useAsignacionesStore.getState().captura
  return features
    .filter((f) => {
      const kind = f.properties?.['kind'] === 'pozo' ? 'pozo' : 'instalacion'
      return capturaPermite(captura, kind, f.properties?.['tipo'])
    })
    .map((f) => {
      const kind = f.properties?.['kind'] === 'pozo' ? 'pozo' : 'inst'
      return `${kind}|${f.properties?.['id']}` as IdObjetivo
    })
}

function crearDraw(map: MaplibreMap): TerraDraw {
  const d = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawRectangleMode({ drawInteraction: 'click-move-or-drag' }),
      new TerraDrawFreehandMode({ drawInteraction: 'click-move-or-drag' }),
    ],
  })
  d.on('finish', (id) => {
    // Capturar la geometría ya; procesar en el próximo tick para no reentrar en
    // el ciclo de vida del modo ni en el render del mapa mientras emite 'finish'.
    const feat = d.getSnapshot().find((f) => f.id === id)
    const coords = (feat?.geometry as GeoJSON.Polygon | undefined)?.coordinates?.[0]
    setTimeout(() => {
      try {
        if (coords && coords.length >= 3) {
          const ids = objetivosEnPoligono(map, coords as number[][])
          if (ids.length > 0) useAsignacionesStore.getState().agregarASeleccion(ids)
        }
      } catch (err) {
        console.error('[seleccion] error procesando polígono:', err)
      }
      if (d.enabled) d.clear()
      // Si la herramienta se activó para un solo uso (clic derecho), vuelve al modo base.
      useAsignacionesStore.getState().consumirUnaVez()
    })
  })
  return d
}

/** Activa el modo de dibujo ('rectangle' | 'freehand'). */
export function activarDibujo(map: MaplibreMap, modo: 'rectangle' | 'freehand'): void {
  if (!draw) draw = crearDraw(map)
  if (!draw.enabled) draw.start()
  draw.setMode(modo)
}

/** Detiene el dibujo; stop() ya limpia el store y las capas temporales. */
export function desactivarDibujo(): void {
  if (draw?.enabled) draw.stop()
}
