import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { NavigationControl, ScaleControl, type MapRef } from 'react-map-gl/maplibre'
import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { agregarFuenteSatelite, aplicarModoBase, ESTILO_VECTORIAL_URL } from './estilos'
import { agregarCapasMarcadores, actualizarDatosMarcadores, aplicarColorPor } from './capasMarcadores'
import { conectarTooltip, conectarSeleccion } from './tooltip'
import { aplicarFiltros } from './filtros'
import { aplicarEstiloLineas, detenerEstiloLineas } from './estiloLineas'
import { mapaInstancia } from './mapaInstancia'
import { activarDibujo, desactivarDibujo } from './seleccion'
import { sincronizarEstadosMapa, reiniciarEstadosMapa } from './asignacionesMapa'
import { pozosAGeoJSON, instalacionesAGeoJSON, lineasAsociacionAGeoJSON } from '@/data/geojson'
import { useDatosStore } from '@/state/datosStore'
import { pozoPasaFiltros, useFiltrosStore } from '@/state/filtrosStore'
import { useAsignacionesStore, type ModoSeleccion } from '@/state/asignacionesStore'
import './MapaBase.css'

type ModoBase = 'vectorial' | 'satelital'

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
  const [modoBase, setModoBase] = useState<ModoBase>('satelital')
  const [mapaListo, setMapaListo] = useState(false)

  const pozos = useDatosStore((s) => s.pozos)
  const instalaciones = useDatosStore((s) => s.instalaciones)
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
      if (!pozoPasaFiltros(p, filtros, instPorId, idsAsignadosHoy)) continue
      if (p.efId) ids.add(p.efId)
      if (p.mgId) ids.add(p.mgId)
    }
    return ids
  }, [filtros, pozos, instalaciones, idsAsignadosHoy])

  const alCargar = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    agregarFuenteSatelite(map)
    aplicarModoBase(map, 'satelital')
    agregarCapasMarcadores(map)
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
      pozosAGeoJSON(pozos, instalaciones),
      instalacionesAGeoJSON(instalaciones),
      lineasAsociacionAGeoJSON(pozos, instalaciones),
    )
    reiniciarEstadosMapa()
    sincronizarEstadosMapa(map)
  }, [mapaListo, pozos, instalaciones])

  // Filtros → setFilter() GPU-side sobre las capas. Incluye el set de
  // asignados-hoy para el filtro Asignado/No asignado (ver filtros.ts).
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    aplicarFiltros(map, filtros, idsAsignadosHoy, idsInstAsociadas)
  }, [mapaListo, filtros, idsAsignadosHoy, idsInstAsociadas])

  // Técnica visual de la línea de asociación (gradiente vs. animado) — efecto
  // aparte del de filtros para no reiniciar la animación en cada cambio de
  // filtro ajeno a las líneas. Se detiene si las líneas están ocultas.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!mapaListo || !map) return
    if (filtros.mostrarLineas) aplicarEstiloLineas(map, filtros.estiloLineas)
    else detenerEstiloLineas()
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

  const alternarModoBase = useCallback(() => {
    setModoBase((actual) => {
      const nuevo: ModoBase = actual === 'vectorial' ? 'satelital' : 'vectorial'
      const map = mapRef.current?.getMap()
      if (map) aplicarModoBase(map, nuevo)
      return nuevo
    })
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

      <button type="button" className="mapa-boton-base" onClick={alternarModoBase}>
        {modoBase === 'vectorial' ? 'Ver satélite' : 'Ver mapa'}
      </button>

      {modoBase === 'satelital' && (
        <div className="mapa-atribucion-satelite">
          EOxCloudless — cloudless.eox.at — Copernicus Sentinel data 2016 &amp; 2017
        </div>
      )}
    </div>
  )
}
