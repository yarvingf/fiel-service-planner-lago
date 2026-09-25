import type { Map as MaplibreMap } from 'maplibre-gl'
import { ID_FUENTE_POZOS, ID_FUENTE_INSTALACIONES } from './capasMarcadores'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'

type Fuente = typeof ID_FUENTE_POZOS | typeof ID_FUENTE_INSTALACIONES

function fuenteDe(objetivoId: string): { fuente: Fuente; id: string } {
  const sep = objetivoId.indexOf('|')
  const kind = objetivoId.slice(0, sep)
  return {
    fuente: kind === 'pozo' ? ID_FUENTE_POZOS : ID_FUENTE_INSTALACIONES,
    id: objetivoId.slice(sep + 1),
  }
}

// Estado ya aplicado al mapa, para poder revertir lo que dejó de corresponder.
const aplicados = new Map<string, string>() // `${fuente}|${id}` → clave serializada del estado

/** setData() borra el feature-state de las fuentes; hay que forzar re-sincronización total. */
export function reiniciarEstadosMapa(): void {
  aplicados.clear()
}

/**
 * Empuja el estado de asignaciones/selección a feature-state de las features.
 * MapLibre lo aplica sin reconstruir el GeoJSON: anillos de selección y colores
 * de cuadrilla se actualizan en tiempo real.
 */
export function sincronizarEstadosMapa(map: MaplibreMap): void {
  const { asignaciones, fecha, cuadrillas, seleccion } = useAsignacionesStore.getState()
  const colorPorId = new Map(cuadrillas.map((c) => [c.id, c.color]))
  const sel = new Set(seleccion)

  const deseados = new Map<string, { fuente: Fuente; id: string; estado: Record<string, unknown> }>()

  const agregar = (objetivoId: string, estado: Record<string, unknown>) => {
    const { fuente, id } = fuenteDe(objetivoId)
    const clave = `${fuente}|${id}`
    const previo = deseados.get(clave)
    deseados.set(clave, {
      fuente,
      id,
      estado: { ...(previo?.estado ?? {}), ...estado },
    })
  }

  for (const a of asignaciones) {
    if (a.fecha !== fecha) continue
    const color = colorPorId.get(a.cuadrillaId)
    if (color) agregar(a.objetivoId, { colorCuadrilla: color })
  }
  for (const id of sel) agregar(id, { seleccionado: true })

  // El seleccionado único (clic en marcador o resultado del buscador) también
  // lleva anillo — sin esto el buscador volaba al pozo pero no se veía cuál era.
  const selUnico = useDatosStore.getState().seleccionado
  if (selUnico) agregar(`${selUnico.kind === 'pozo' ? 'pozo' : 'inst'}|${selUnico.id}`, { seleccionado: true })

  // Nunca usar removeFeatureState: un bug de maplibre revienta en updateState
  // (indexa state[sourceLayer] antes del primer coalesce). Para anular claves
  // se escribe null — las expresiones lo evalúan igual que "sin estado".
  const nulosDe = (serializado: string | undefined): Record<string, unknown> =>
    serializado ? Object.fromEntries(Object.keys(JSON.parse(serializado)).map((k) => [k, null])) : {}

  // Revertir lo que ya no corresponde
  for (const [clave, previo] of aplicados) {
    if (!deseados.has(clave)) {
      const sep = clave.indexOf('|')
      const nulos = nulosDe(previo)
      if (Object.keys(nulos).length > 0) {
        map.setFeatureState({ source: clave.slice(0, sep), id: clave.slice(sep + 1) }, nulos)
      }
      aplicados.delete(clave)
    }
  }

  // Aplicar lo nuevo/cambiado
  for (const [clave, { fuente, id, estado }] of deseados) {
    const estadoFinal = { ...nulosDe(aplicados.get(clave)), ...estado }
    const serializado = JSON.stringify(estadoFinal)
    if (aplicados.get(clave) === serializado) continue
    map.setFeatureState({ source: fuente, id }, estadoFinal)
    aplicados.set(clave, serializado)
  }
}
