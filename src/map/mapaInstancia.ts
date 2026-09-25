import type { Map as MaplibreMap } from 'maplibre-gl'

/**
 * Referencia global a la instancia del mapa, asignada por MapaBase al cargar.
 * Permite que componentes fuera del árbol del mapa (buscador, futuros paneles)
 * ejecuten flyTo/setFilter sin prop-drilling.
 */
export const mapaInstancia: { current: MaplibreMap | null } = { current: null }
