import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { NavigationControl, ScaleControl, type MapRef } from 'react-map-gl/maplibre'
import { setWorkerUrl, type MapLayerMouseEvent } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { agregarFuenteSatelite, aplicarModoBase, limpiarCapasIrrelevantes, ESTILO_VECTORIAL_URL, type ModoBaseMapa } from './estilos'
import { agregarCapasMarcadores, actualizarDatosMarcadores, aplicarColorPor, ID_CAPA_POZOS, ID_CAPA_INSTALACIONES } from './capasMarcadores'
import { conectarTooltip, conectarSeleccion } from './tooltip'
import { aplicarFiltros } from './filtros'
import { aplicarEstiloLineas, aplicarEstiloRuta, detenerEstiloLineas } from './estiloLineas'
import { mapaInstancia } from './mapaInstancia'
import { activarDibujo, desactivarDibujo } from './seleccion'
import { sincronizarEstadosMapa, reiniciarEstadosMapa } from './asignacionesMapa'
import { agregarCapasRuta } from './capasRuta'
import { pozosAGeoJSON, instalacionesAGeoJSON, lineasAsociacionAGeoJSON } from '@/data/geojson'
import { useDatosStore } from '@/state/datosStore'
import { pozoPasaFiltros, useFiltrosStore } from '@/state/filtrosStore'
import { diasSinVisitaPorPozo } from '@/domain/visitaCampo'
import { pozosConIndicador } from '@/domain/indicadores'
import { useAsignacionesStore, type ModoSeleccion } from '@/state/asignacionesStore'
import { MenuContextual, type PosMenuContextual } from '@/ui/MenuContextual'
import './MapaBase.css'

type ModoBase = ModoBaseMapa

const OPCIONES_BASE: { modo: ModoBase; etiqueta: string }[] = [
  { modo: 'vectorial', etiqueta: 'Mapa' },
  { modo: 'satelital', etiqueta: 'Satélite' },
  { modo: 'satelitalHd', etiqueta: 'HD' },
]

/**
 * Vista inicial centrada en el Lago de Maracaibo, cubriendo los campos de
 * interés (BA ~9.83°N, VLC/VLG ~10.06°N), zoom que muestra el lago completo.
 */
const VISTA_INICIAL = { longitude: -71.35, latitude: 9.95, zoom: 9.2 }

// maplibre-gl v6 + Vite: el worker (que descarga/parsea tiles vectoriales) debe
// empaquetarse con ?worker&url para que sea autocontenido; si no, los tiles
// vectoriales nunca se solicitan y el mapa queda en blanco sin errores.
setWorkerUrl(maplibreWorkerUrl)

export function MapaBase() {
  const mapRef = useRef<MapRef | null>(null)
  const [modoBase, setModoBase] = useState<ModoBase>('satelitalHd')
  const [mapaListo, setMapaListo] = useState(false)
  const [menuContextual, setMenuContextual] = useState<PosMenuContextual | null>(null)

  const pozos = useDatosStore((s) => s.pozos)
  const instalaciones = useDatosStore((s) => s.instalaciones)
  const visitas = useDatosStore((s) => s.visitas)
  const indicadores = useDatosStore((s) => s.indicadores)
  const seleccionado = useDatosStore((s) => s.seleccionado)
  const filtros = useFiltrosStore((s) => s.filtros)
  const { modoSeleccion, asignaciones, fecha, cuadrillas, seleccion, colorPor } = useAsignacionesStore()

  // Ids "pozo|x" / "inst|x" con asignación en la fecha del plan actual — lo
  // usa el filtro Asignado/No asignado. Se recalcula solo si cambian las
  // asignaciones o la fecha, no en cada render.
  const idsAsignadosHoy = useMemo(() => {
    const ids = new Set<string>()
    for (const a of asignaciones) if (a.fecha === fecha) ids.add(a.objetivoId)
    return ids
  }, [asignaciones, fecha])

  // Días desde la última visita GL/BES por pozo — alimenta el filtro
  // "sin visita ≥ X días" (GeoJSON + predicado JS). Los pozos sin visita no
  // aparecen en el mapa: pozoPasaFiltros los cuenta como "nunca visitados".
  const diasSinVisita = useMemo(() => diasSinVisitaPorPozo(visitas), [visitas])

  // Ids de pozos que tienen alguno de los indicadores elegidos dentro del
  // periodo — se calcula JS-side sobre la tabla reducida pozo_indicadores
  // (~miles de filas), no sobre el historial completo.
  const idsIndicador = useMemo(
    () =>
      pozosConIndicador(indicadores, filtros.indicadoresFiltro, filtros.indicadorPeriodo, {
        desde: filtros.indicadorDesde,
      }),
    [indicadores, filtros.indicadoresFiltro, filtros.indicadorPeriodo, filtros.indicadorDesde],
  )

  // Ids de instalaciones referenciadas (efId/mgId) por los pozos que pasan los
  // filtros actuales — alimenta "solo instalaciones asociadas". Las
  // expresiones de MapLibre no pueden hacer join entre fuentes, así que el
  // set se calcula JS-side con el mismo predicado de visibilidad.
  const idsInstAsociadas = useMemo(() => {
    if (!filtros.soloInstAsociadas) return null
    // `Map` aquí es el componente de react-map-gl (sombrea el global) — por
    // eso se invoca explícito vía globalThis.
    const instPorId = new globalThis.Map(instalaciones.map((i) => [i.id, i] as const))
    const ids = new Set<string>()
    for (const p of pozos) {
      if (!pozoPasaFiltros(p, filtros, instPorId, idsAsignadosHoy, diasSinVisita, idsIndicador)) continue
      if (p.efId) ids.add(p.efId)
      if (p.mgId) ids.add(p.mgId)
    }
    return ids
  }, [filtros, pozos, instalaciones, idsAsignadosHoy, diasSinVisita, idsIndicador])

  const alCargar = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    agregarFuenteSatelite(map)
    // Elimina capas de escudos de autopista del estilo remoto (irrelevantes en
    // el lago, generan warnings de sprites ausentes). Antes de aplicarModoBase
    // para que no queden capturadas en capasEstiloBase.
    limpiarCapasIrrelevantes(map)
    aplicarModoBase(map, 'satelitalHd')
    agregarCapasMarcadores(map)
    agregarCapasRuta(map)
    conectarTooltip(map)
    conectarSeleccion(map)
    mapaInstancia.current = map
    setMapaListo(true)
  }, [])

  // Cuando el import termina, empuja los datos a las fuentes GeoJSON del mapa.
  // setData() borra el feature-state → hay que re-sincronizar selección/cuadrillas.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    actualizarDatosMarcadores(
      map,
      pozosAGeoJSON(pozos, instalaciones, diasSinVisita),
      instalacionesAGeoJSON(instalaciones),
      lineasAsociacionAGeoJSON(pozos, instalaciones, diasSinVisita),
    )
    reiniciarEstadosMapa()
    sincronizarEstadosMapa(map)
  }, [mapaListo, pozos, instalaciones, diasSinVisita])

  // Filtros → setFilter() GPU-side sobre las capas. Incluye el set de
  // asignados-hoy para el filtro Asignado/No asignado (ver filtros.ts).
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    aplicarFiltros(map, filtros, idsAsignadosHoy, idsInstAsociadas, idsIndicador)
  }, [mapaListo, filtros, idsAsignadosHoy, idsInstAsociadas, idsIndicador])

  // Técnica visual de la línea de asociación (gradiente vs. animado) — efecto
  // aparte del de filtros para no reiniciar la animación en cada cambio de
  // filtro ajeno a las líneas. Se detiene si las líneas están ocultas.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    if (filtros.mostrarLineas) aplicarEstiloLineas(map, filtros.estiloLineas)
    else detenerEstiloLineas()
    // La ruta trazada sigue la misma técnica (gradiente/animado) pero no el
    // interruptor de visibilidad de las líneas EF/MG: el usuario la dibuja a
    // propósito con el botón Trazar.
    aplicarEstiloRuta(map, filtros.estiloLineas)
    return () => detenerEstiloLineas()
  }, [mapaListo, filtros.mostrarLineas, filtros.estiloLineas])

  // Selección/asignaciones → feature-state (anillos y colores de cuadrilla).
  // Incluye `seleccionado` (clic/buscador) para que también lleve anillo.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    sincronizarEstadosMapa(map)
  }, [mapaListo, asignaciones, fecha, cuadrillas, seleccion, seleccionado])

  // Modo de color: estatus vs cuadrilla asignada.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    aplicarColorPor(map, colorPor)
  }, [mapaListo, colorPor])

  // Clic derecho sobre pozo/instalación → menú contextual (asignar, selección,
  // detalle, copiar línea WhatsApp). En canvas vacío queda el menú del navegador.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    const abrir = (e: MapLayerMouseEvent) => {
      e.preventDefault()
      const f = e.features?.[0]
      const id = f?.properties?.['id']
      if (!f || !id) return
      setMenuContextual({
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        kind: f.properties?.['kind'] === 'pozo' ? 'pozo' : 'instalacion',
        id: String(id),
      })
    }
    const cerrar = () => setMenuContextual(null)
    map.on('contextmenu', ID_CAPA_POZOS, abrir)
    map.on('contextmenu', ID_CAPA_INSTALACIONES, abrir)
    map.on('click', cerrar)
    map.on('movestart', cerrar)
    return () => {
      map.off('contextmenu', ID_CAPA_POZOS, abrir)
      map.off('contextmenu', ID_CAPA_INSTALACIONES, abrir)
      map.off('click', cerrar)
      map.off('movestart', cerrar)
    }
  }, [mapaListo])

  // Modo de dibujo (rectángulo / lazo) para seleccionar objetivos.
  // 'multi' no usa Terra Draw: alterna objetivos con clic vía conectarSeleccion.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    if (modoSeleccion === 'rectangle' || modoSeleccion === 'freehand') activarDibujo(map, modoSeleccion)
    else desactivarDibujo()
    return () => desactivarDibujo()
  }, [mapaListo, modoSeleccion])

  // Atajos: mantener Ctrl/Mayús/Alt activa una herramienta mientras la tecla
  // está presionada, sin tocar el modo pegajoso de la barra; al soltarla,
  // vuelve a él. Se ignora si el foco está en un campo de texto (búsqueda, etc.).
  useEffect(() => {
    const TECLA_A_MODO: Record<string, Exclude<ModoSeleccion, false>> = {
      Control: 'multi',
      Shift: 'rectangle',
      Alt: 'freehand',
    }
    let teclaActiva: string | null = null

    const esCampoTexto = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const alBajar = (e: KeyboardEvent) => {
      if (e.repeat || teclaActiva || esCampoTexto(e.target)) return
      const modo = TECLA_A_MODO[e.key]
      if (!modo) return
      teclaActiva = e.key
      useAsignacionesStore.getState().activarModoTemporal(modo)
    }
    const alSoltar = (e: KeyboardEvent) => {
      if (e.key !== teclaActiva) return
      teclaActiva = null
      useAsignacionesStore.getState().restaurarModoBase()
    }
    const alPerderFoco = () => {
      if (!teclaActiva) return
      teclaActiva = null
      useAsignacionesStore.getState().restaurarModoBase()
    }

    window.addEventListener('keydown', alBajar)
    window.addEventListener('keyup', alSoltar)
    window.addEventListener('blur', alPerderFoco)
    return () => {
      window.removeEventListener('keydown', alBajar)
      window.removeEventListener('keyup', alSoltar)
      window.removeEventListener('blur', alPerderFoco)
    }
  }, [])

  const cambiarModoBase = useCallback((nuevo: ModoBase) => {
    const map = mapRef.current?.getMap()
    if (map) aplicarModoBase(map, nuevo)
    setModoBase(nuevo)
  }, [])

  return (
    <div className="mapa-contenedor">
      <Map
        ref={mapRef}
        initialViewState={VISTA_INICIAL}
        mapStyle={ESTILO_VECTORIAL_URL}
        onLoad={alCargar}
        style={{ width: '100%', height: '100%' }}
        // Mayús+arrastrar es nuestro atajo de Rectángulo; el box-zoom nativo
        // de MapLibre usa el mismo gesto y competía con él (zoom raro al soltar).
        boxZoom={false}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />
      </Map>

      <div className="mapa-base-segmentado">
        {OPCIONES_BASE.map(({ modo, etiqueta }) => (
          <button
            key={modo}
            type="button"
            className={modoBase === modo ? 'mapa-base-activo' : ''}
            title={
              modo === 'satelitalHd'
                ? 'Satélite HD (Esri/Maxar): máxima resolución disponible en el lago'
                : modo === 'satelital'
                  ? 'Satélite Sentinel-2 (~10 m/px): útil si el HD no carga'
                  : 'Mapa vectorial oscuro, sin imagen'
            }
            onClick={() => cambiarModoBase(modo)}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {modoBase !== 'vectorial' && (
        <div className="mapa-atribucion-satelite">
          {modoBase === 'satelitalHd'
            ? 'Esri, Maxar, Earthstar Geographics'
            : 'EOxCloudless — Copernicus Sentinel data'}
        </div>
      )}

      {menuContextual && (
        <MenuContextual {...menuContextual} onCerrar={() => setMenuContextual(null)} />
      )}
    </div>
  )
}
