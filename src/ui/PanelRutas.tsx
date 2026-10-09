import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LngLatBounds } from 'maplibre-gl'
import { useAsignacionesStore, type IdObjetivo } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'
import { calcularRuta, fmtDuracion, minutosDe, velocidadEfectiva, type ParadaRuta, type RutaCalculada } from '@/domain/ruta'
import { dibujarRuta, limpiarRuta } from '@/map/capasRuta'
import { mapaInstancia } from '@/map/mapaInstancia'
import { formatearFecha } from '@/domain/fecha'
import './PanelRutas.css'

interface Props {
  onCerrar: () => void
}

const KEY_NUDOS = 'fsp.ruta.nudos'
const KEY_CERRADA = 'fsp.ruta.regreso'
const KEY_CORRIENTE = 'fsp.ruta.corriente'
const KEY_MARGEN = 'fsp.ruta.margen'

/** El muelle de partida: el pozo BA-2283 (la instalación de amarre queda a su lado). */
const CODIGO_MUELLE = '2283'

interface ResultadoCuadrilla {
  cuadrillaId: string
  nombre: string
  color: string
  paradasPerdidas: number
  ruta: RutaCalculada
}

/**
 * Panel de rutas del día: por cada cuadrilla con asignaciones calcula el
 * orden de visita óptimo saliendo del muelle (vecino más cercano + 2-opt
 * sobre distancia gran círculo) y traza la línea roja con sentido en el
 * mapa. Es flotante (sin fondo) para seguir interactuando con el mapa.
 */
export function PanelRutas({ onCerrar }: Props) {
  const { asignaciones, cuadrillas, fecha } = useAsignacionesStore()
  const { pozos, instalaciones } = useDatosStore()

  const [nudosTxt, setNudosTxt] = useState(() => localStorage.getItem(KEY_NUDOS) ?? '15')
  const [corrienteTxt, setCorrienteTxt] = useState(() => localStorage.getItem(KEY_CORRIENTE) ?? '0')
  const [margenTxt, setMargenTxt] = useState(() => localStorage.getItem(KEY_MARGEN) ?? '10')
  const [cerrada, setCerrada] = useState(() => localStorage.getItem(KEY_CERRADA) !== '0')
  const [solo, setSolo] = useState<'todas' | string>('todas')
  const [resultados, setResultados] = useState<ResultadoCuadrilla[] | null>(null)
  const [aviso, setAviso] = useState('')

  const nudos = Number(nudosTxt)
  // Corriente positiva = en contra (resta); negativa = a favor (suma).
  const corriente = Number.isFinite(Number(corrienteTxt)) ? Number(corrienteTxt) : 0
  const margen = Number.isFinite(Number(margenTxt)) ? Math.max(0, Number(margenTxt)) : 0

  const coordsDe = useMemo(() => {
    const m = new Map<IdObjetivo, { lon: number; lat: number }>()
    for (const p of pozos) if (p.lon !== null && p.lat !== null) m.set(`pozo|${p.id}`, { lon: p.lon, lat: p.lat })
    for (const i of instalaciones) if (i.lon !== null && i.lat !== null) m.set(`inst|${i.id}`, { lon: i.lon, lat: i.lat })
    return m
  }, [pozos, instalaciones])

  const muelle = useMemo<ParadaRuta | null>(() => {
    const p = pozos.find((pz) => pz.codigo.includes(CODIGO_MUELLE) && pz.lon !== null && pz.lat !== null)
    return p ? { codigo: `Muelle (${p.codigo})`, lon: p.lon!, lat: p.lat! } : null
  }, [pozos])

  // Cuadrillas con asignaciones en la fecha (incluye archivadas: su plan del
  // día también se puede enrutar — la ruta no depende del estado activa).
  const grupos = useMemo(
    () =>
      cuadrillas
        .map((c) => ({
          cuadrilla: c,
          items: asignaciones.filter((a) => a.fecha === fecha && a.cuadrillaId === c.id),
        }))
        .filter((g) => g.items.length > 0),
    [asignaciones, cuadrillas, fecha],
  )

  // Al cambiar la fecha el trazado dibujado ya no corresponde: los resultados
  // se descartan durante el render (patrón de React) y la capa del mapa (un
  // sistema externo) se limpia en el efecto.
  const [fechaAntes, setFechaAntes] = useState(fecha)
  if (fecha !== fechaAntes) {
    setFechaAntes(fecha)
    setResultados(null)
  }
  useEffect(() => {
    limpiarRuta(mapaInstancia.current!)
  }, [fecha])

  // Al cerrar el panel también se desmonta el trazado.
  useEffect(() => () => limpiarRuta(mapaInstancia.current!), [])

  const persistir = (campo: string, valor: string) => {
    try {
      localStorage.setItem(campo, valor)
    } catch {
      /* localStorage bloqueado — no persistir */
    }
  }

  const trazar = () => {
    const map = mapaInstancia.current
    setAviso('')
    if (!map) return
    if (!muelle) {
      setAviso(`No se encontró el pozo del muelle (*${CODIGO_MUELLE}) en los datos importados.`)
      return
    }
    if (!(nudos > 0)) {
      setAviso('Indica una velocidad en nudos mayor que cero.')
      return
    }

    const elegidas = grupos.filter((g) => solo === 'todas' || g.cuadrilla.id === solo)
    const resultadosNuevos: ResultadoCuadrilla[] = []
    for (const { cuadrilla, items } of elegidas) {
      const paradas: ParadaRuta[] = []
      let perdidas = 0
      for (const a of items) {
        const c = coordsDe.get(a.objetivoId)
        if (c) paradas.push({ codigo: a.codigo, lon: c.lon, lat: c.lat })
        else perdidas++
      }
      if (paradas.length === 0) continue
      resultadosNuevos.push({
        cuadrillaId: cuadrilla.id,
        nombre: cuadrilla.nombre,
        color: cuadrilla.color,
        paradasPerdidas: perdidas,
        ruta: calcularRuta(muelle, paradas, cerrada),
      })
    }
    setResultados(resultadosNuevos)

    if (resultadosNuevos.length === 0) {
      limpiarRuta(map)
      setAviso('Ninguna de las cuadrillas elegidas tiene paradas con coordenadas.')
      return
    }

    dibujarRuta(map, resultadosNuevos.map((r) => ({ cuadrillaId: r.cuadrillaId, origen: muelle, ruta: r.ruta, cerrada })))

    // Encuadra muelle + todas las paradas trazadas.
    const bounds = new LngLatBounds([muelle.lon, muelle.lat], [muelle.lon, muelle.lat])
    for (const r of resultadosNuevos) for (const p of r.ruta.orden) bounds.extend([p.lon, p.lat])
    map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 800 })
  }

  const quitar = () => {
    limpiarRuta(mapaInstancia.current!)
    setResultados(null)
    setAviso('')
  }

  return createPortal(
    <div className="pr-panel">
      <div className="pr-titulo">
        Rutas del día · {formatearFecha(fecha)}
        <button type="button" className="pr-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
      </div>

      <div className="pr-controles">
        <label className="pr-campo">
          Nudos
          <input
            type="number"
            min={1}
            max={45}
            value={nudosTxt}
            onChange={(e) => { setNudosTxt(e.target.value); persistir(KEY_NUDOS, e.target.value) }}
          />
        </label>
        <label className="pr-campo" title="Nudos de corriente/marea en contra (negativo = a favor)">
          Corriente −
          <input
            type="number"
            min={-15}
            max={15}
            step={0.5}
            value={corrienteTxt}
            onChange={(e) => { setCorrienteTxt(e.target.value); persistir(KEY_CORRIENTE, e.target.value) }}
          />
        </label>
        <label className="pr-campo" title="Buffer % por maniobra, oleaje y atraque en cada tramo">
          Margen %
          <input
            type="number"
            min={0}
            max={100}
            value={margenTxt}
            onChange={(e) => { setMargenTxt(e.target.value); persistir(KEY_MARGEN, e.target.value) }}
          />
        </label>
        <label className="pr-check">
          <input
            type="checkbox"
            checked={cerrada}
            onChange={(e) => { setCerrada(e.target.checked); persistir(KEY_CERRADA, e.target.checked ? '1' : '0') }}
          />
          Volver al muelle
        </label>
        <select className="pr-select" value={solo} onChange={(e) => setSolo(e.target.value)}>
          <option value="todas">Todas las cuadrillas</option>
          {grupos.map((g) => (
            <option key={g.cuadrilla.id} value={g.cuadrilla.id}>
              {g.cuadrilla.nombre} ({g.items.length})
            </option>
          ))}
        </select>
        <div className="pr-acciones">
          <button type="button" className="pr-trazar" onClick={trazar} disabled={grupos.length === 0}>
            Trazar
          </button>
          <button type="button" onClick={quitar} disabled={!resultados}>
            Quitar
          </button>
        </div>
      </div>

      {aviso && <div className="pr-aviso">{aviso}</div>}
      {!muelle && !aviso && (
        <div className="pr-aviso">Muelle no encontrado: falta el pozo *{CODIGO_MUELLE} en la importación.</div>
      )}

      <div className="pr-cuerpo">
        {resultados?.map((r) => {
          const ruta = r.ruta
          const minTotal = minutosDe(ruta.totalNm, nudos, corriente, margen)
          let acumulado = 0
          return (
            <div key={r.cuadrillaId} className="pr-grupo">
              <div className="pr-grupo-titulo">
                <span className="pr-punto" style={{ background: r.color }} />
                {r.nombre}
                <span className="pr-total" title={`Velocidad efectiva ${velocidadEfectiva(nudos, corriente).toFixed(1)} kn · margen +${margen}%`}>
                  {ruta.orden.length} paradas · {ruta.totalNm.toFixed(1)} nm · {fmtDuracion(minTotal)}
                </span>
              </div>
              <ol className="pr-lista">
                <li className="pr-parada pr-muelle">⚓ {muelle?.codigo ?? 'Muelle'}</li>
                {ruta.orden.map((p, i) => {
                  const tramo = ruta.tramos[i]
                  acumulado += minutosDe(tramo.nm, nudos, corriente, margen)
                  return (
                    <li key={p.codigo} className="pr-parada">
                      <span className="pr-orden">{i + 1}</span>
                      <span className="pr-codigo">{p.codigo}</span>
                      <span className="pr-tramo">
                        +{tramo.nm.toFixed(1)} nm · {fmtDuracion(minutosDe(tramo.nm, nudos, corriente, margen))} (llega {fmtDuracion(acumulado)})
                      </span>
                    </li>
                  )
                })}
                {cerrada && ruta.orden.length > 0 && (
                  <li className="pr-parada pr-muelle">
                    ⚓ Regreso: {ruta.tramos[ruta.tramos.length - 1].nm.toFixed(1)} nm ·{' '}
                    {fmtDuracion(minutosDe(ruta.tramos[ruta.tramos.length - 1].nm, nudos, corriente, margen))}
                  </li>
                )}
              </ol>
              {r.paradasPerdidas > 0 && (
                <div className="pr-perdidas">{r.paradasPerdidas} objetivo(s) sin coordenadas — fuera de la ruta.</div>
              )}
            </div>
          )
        })}
        {resultados === null && grupos.length === 0 && (
          <div className="pr-vacio">Sin asignaciones en esta fecha.</div>
        )}
        {resultados === null && grupos.length > 0 && (
          <div className="pr-vacio">
            Indica la velocidad de la lancha y pulsa <b>Trazar</b> — se dibuja en rojo el orden de visita desde el muelle.
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
