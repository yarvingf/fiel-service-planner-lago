import type { ExpressionSpecification, FilterSpecification, Map as MaplibreMap } from 'maplibre-gl'
import { ID_CAPA_LINEAS_HALO, ID_CAPA_POZOS_HALO, FILTRO_OCULTO } from './capasMarcadores'
import { expresionPozos, expresionLineas } from './filtros'
import { useFiltrosStore } from '@/state/filtrosStore'
import { idsAsignadosActuales } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'
import { pozosConIndicador } from '@/domain/indicadores'

/**
 * Resalta el grupo (pozo + su EF/MG) conectado a un código, con una sombra
 * blanca (glow) detrás de la línea y de los pozos asociados — sin tocar la
 * opacidad ni el color del resto, que sigue exactamente igual. `null` apaga
 * el resaltado (oculta ambos halos).
 *
 * El halo solo se muestra sobre lo que YA sería visible con el filtro activo
 * (estatus/campo/etc.) — un pozo Cerrado oculto por el filtro no debe
 * iluminarse solo porque comparte MG con el pozo bajo el mouse.
 */
export function resaltarLineas(map: MaplibreMap, codigo: string | null): void {
  if (!map.getLayer(ID_CAPA_LINEAS_HALO) || !map.getLayer(ID_CAPA_POZOS_HALO)) return
  if (codigo === null) {
    map.setFilter(ID_CAPA_LINEAS_HALO, FILTRO_OCULTO)
    map.setFilter(ID_CAPA_POZOS_HALO, FILTRO_OCULTO)
    return
  }
  const filtros = useFiltrosStore.getState().filtros
  const idsAsignados = filtros.asignacionFiltro === 'todos' ? null : idsAsignadosActuales()
  const idsIndicador = pozosConIndicador(
    useDatosStore.getState().indicadores,
    filtros.indicadoresFiltro,
    filtros.indicadorPeriodo,
    { desde: filtros.indicadorDesde },
  )
  // OJO: cada línea (sea EF o MG) lleva AMBAS propiedades `ef` y `mg` del pozo
  // en su extremo (para que el pozo pueda resaltar sus dos conexiones a la
  // vez). Comparar `ef`/`mg` sin cruzarlo con `tipoLinea` hacía que, al pasar
  // el mouse por una MG, también se iluminaran líneas EF de pozos que
  // comparten esa MG — bug reportado. Cada rama solo calza con su propio tipo.
  const esLineaDelGrupo: ExpressionSpecification = [
    'any',
    ['==', ['get', 'pozoCodigo'], codigo],
    ['all', ['==', ['get', 'tipoLinea'], 'EF'], ['==', ['get', 'ef'], codigo]],
    ['all', ['==', ['get', 'tipoLinea'], 'MG'], ['==', ['get', 'mg'], codigo]],
  ]
  const esPozoDelGrupo: ExpressionSpecification = [
    'any',
    ['==', ['get', 'codigo'], codigo],
    ['==', ['get', 'ef'], codigo],
    ['==', ['get', 'mg'], codigo],
  ]
  map.setFilter(ID_CAPA_LINEAS_HALO, ['all', esLineaDelGrupo, expresionLineas(filtros, idsAsignados, idsIndicador)] as FilterSpecification)
  map.setFilter(ID_CAPA_POZOS_HALO, ['all', esPozoDelGrupo, expresionPozos(filtros, idsAsignados, idsIndicador)] as FilterSpecification)
}
