import type { ExpressionSpecification, FilterSpecification, Map as MaplibreMap } from 'maplibre-gl'
import {
  ID_CAPA_POZOS,
  ID_CAPA_POZOS_ETIQUETAS,
  ID_CAPA_INSTALACIONES,
  ID_CAPA_INSTALACIONES_ETIQUETAS,
  ID_CAPA_INST_HALO,
  ID_CAPA_LINEAS,
  ID_CAPA_LINEAS_HALO,
  ID_CAPA_LINEAS_EF,
  ID_CAPA_LINEAS_MG,
  ID_CAPA_LINEAS_EF_GROSOR,
  ID_CAPA_LINEAS_MG_GROSOR,
  ID_CAPA_LINEAS_CABEZA,
} from './capasMarcadores'
import type { Filtros } from '@/state/filtrosStore'

/**
 * Traduce el estado de filtros a expresiones de MapLibre. Se aplican con
 * setFilter(): el descarte corre en el pipeline del mapa (GPU-side), sin
 * tocar React ni reconstruir el GeoJSON.
 */

/** null = sin filtrar (todos pasan); lista = solo esos códigos exactos. */
function perteneceA(propiedad: string, seleccion: string[] | null): ExpressionSpecification | boolean {
  if (seleccion === null) return true
  return ['in', ['get', propiedad], ['literal', seleccion]]
}

/**
 * Criterio de asignación del día: compara `prefijo + id` (ej. "pozo|pozo-BA_0345")
 * contra el set de objetivos asignados hoy. `idsAsignados` es opcional porque
 * `resaltado.ts` y otros usos puntuales pueden omitirlo cuando el filtro
 * está en 'todos' (no hace falta calcularlo).
 */
function criterioAsignacion(
  f: Filtros,
  prefijo: 'pozo|' | 'inst|',
  idsAsignados: ReadonlySet<string> | null | undefined,
): ExpressionSpecification | boolean {
  if (f.asignacionFiltro === 'todos' || !idsAsignados) return true
  const estaAsignado: ExpressionSpecification = ['in', ['concat', prefijo, ['get', 'id']], ['literal', [...idsAsignados]]]
  return f.asignacionFiltro === 'asignado' ? estaAsignado : ['!', estaAsignado]
}

export function expresionPozos(f: Filtros, idsAsignados?: ReadonlySet<string> | null): FilterSpecification {
  const partes: unknown[] = [
    'all',
    ['in', ['get', 'estatus'], ['literal', f.estatus]],
    ['in', ['get', 'campo'], ['literal', f.campos]],
    ['>=', ['get', 'potDifConfirmado'], f.diferidoMin],
    ['>=', ['get', 'bnpdActivo'], f.bnpdMin],
    perteneceA('ef', f.efFiltro),
    perteneceA('mg', f.mgFiltro),
    criterioAsignacion(f, 'pozo|', idsAsignados),
  ]
  // El pozo pasa si CUALQUIERA de sus métodos está seleccionado
  // ('metodos' es un string "GL,BES" — 'in' sobre string hace substring,
  // y ninguno de los métodos es substring de otro).
  if (f.metodos.length > 0) {
    partes.push(['any', ...f.metodos.map((m) => ['in', m, ['get', 'metodos']])])
  } else {
    partes.push(false)
  }
  return partes as FilterSpecification
}

function expresionInstalaciones(
  f: Filtros,
  idsAsignados?: ReadonlySet<string> | null,
  idsAsociadas?: ReadonlySet<string> | null,
): FilterSpecification {
  // tiposInst null = todos los tipos; [] (estado inicial) = ninguno — el
  // 'in' contra una lista vacía ya no calza con ningún tipo, así que no
  // hace falta un booleano aparte para "ocultar todo".
  return [
    'all',
    perteneceA('tipo', f.tiposInst),
    ['in', ['get', 'campo'], ['literal', f.campos]],
    criterioAsignacion(f, 'inst|', idsAsignados),
    // Solo instalaciones que algún pozo visible referencia via efId/mgId.
    // `idsAsociadas` se calcula JS-side (las expresiones no pueden hacer
    // join entre fuentes); set vacío = no se ve ninguna instalación.
    f.soloInstAsociadas && idsAsociadas
      ? ['in', ['get', 'id'], ['literal', [...idsAsociadas]]]
      : !f.soloInstAsociadas,
  ]
}

/**
 * Una línea solo se ve si su pozo sería visible (mismo filtro que expresionPozos,
 * las líneas llevan las mismas propiedades) Y el tipo de instalación al que
 * conecta (EF/MG) está habilitado en el filtro de instalaciones.
 */
export function expresionLineas(f: Filtros, idsAsignados?: ReadonlySet<string> | null): FilterSpecification {
  return ['all', expresionPozos(f, idsAsignados), perteneceA('tipoLinea', f.tiposInst)] as FilterSpecification
}

export function aplicarFiltros(
  map: MaplibreMap,
  f: Filtros,
  idsAsignados?: ReadonlySet<string> | null,
  idsInstAsociadas?: ReadonlySet<string> | null,
): void {
  const filtroPozos = expresionPozos(f, idsAsignados)
  const filtroInst = expresionInstalaciones(f, idsAsignados, idsInstAsociadas)
  for (const capa of [ID_CAPA_POZOS, ID_CAPA_POZOS_ETIQUETAS]) {
    if (map.getLayer(capa)) map.setFilter(capa, filtroPozos)
  }
  for (const capa of [ID_CAPA_INSTALACIONES, ID_CAPA_INSTALACIONES_ETIQUETAS, ID_CAPA_INST_HALO]) {
    if (map.getLayer(capa)) map.setFilter(capa, filtroInst)
  }
  const filtroLineas = expresionLineas(f, idsAsignados)
  // Capa principal: solo el modo "animado" (guión + cabecita). En modo
  // "gradiente" la reemplazan las capas por tipo EF/MG — line-gradient no
  // admite leer 'tipoLinea' del feature, así que cada capa lleva su color
  // fijo y se filtra aparte por tipo.
  if (map.getLayer(ID_CAPA_LINEAS)) {
    map.setFilter(ID_CAPA_LINEAS, filtroLineas)
    const visible = f.mostrarLineas && f.estiloLineas === 'animado'
    map.setLayoutProperty(ID_CAPA_LINEAS, 'visibility', visible ? 'visible' : 'none')
  }
  // Capas del modo gradiente: mismo filtro dinámico + restricción por tipo.
  const visibleGradiente = f.mostrarLineas && f.estiloLineas === 'gradiente'
  for (const [capa, tipo] of [
    [ID_CAPA_LINEAS_EF, 'EF'],
    [ID_CAPA_LINEAS_MG, 'MG'],
    [ID_CAPA_LINEAS_EF_GROSOR, 'EF'],
    [ID_CAPA_LINEAS_MG_GROSOR, 'MG'],
  ] as const) {
    if (!map.getLayer(capa)) continue
    map.setFilter(capa, ['all', filtroLineas, ['==', ['get', 'tipoLinea'], tipo]] as FilterSpecification)
    map.setLayoutProperty(capa, 'visibility', visibleGradiente ? 'visible' : 'none')
  }
  // Cabecita animada: mismo filtro, pero visible solo en modo "animado".
  if (map.getLayer(ID_CAPA_LINEAS_CABEZA)) {
    map.setFilter(ID_CAPA_LINEAS_CABEZA, filtroLineas)
    const visibleCabeza = f.mostrarLineas && f.estiloLineas === 'animado'
    map.setLayoutProperty(ID_CAPA_LINEAS_CABEZA, 'visibility', visibleCabeza ? 'visible' : 'none')
  }
  // El halo blanco de hover mantiene su propio filter (ver resaltarLineas) —
  // aquí solo se sincroniza el interruptor maestro de "ver líneas".
  if (map.getLayer(ID_CAPA_LINEAS_HALO)) {
    map.setLayoutProperty(ID_CAPA_LINEAS_HALO, 'visibility', f.mostrarLineas ? 'visible' : 'none')
  }
}
