import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GridApi } from 'ag-grid-community'
import { useAsignacionesStore, type AsignacionRec, type IdObjetivo } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'
import { construirDetalleObjetivos } from '@/domain/detalleAsignacion'
import { formatearFecha } from '@/domain/fecha'
import { exportarPlanExcel } from '@/data/exportarPlanExcel'
import { construirMensajeWhatsApp } from '@/data/mensajeWhatsApp'
import { TablaAsignaciones } from './TablaAsignaciones'
import type { CamposAsignacion } from '@/data/persistencia'
import { mapaInstancia } from '@/map/mapaInstancia'
import './ModalAsignaciones.css'

/** Sugerencias para el input de actividad (datalist — texto libre igualmente). */
const SUGERENCIAS_ACTIVIDAD = [
  'Inspección',
  'Medición',
  'Mantenimiento',
  'Reparación',
  'Prueba de producción',
  'Limpieza de locación',
]

interface Props {
  abierto: boolean
  onCerrar: () => void
}

/**
 * Detalle del plan del día: asignaciones agrupadas por cuadrilla. Todas las
 * ediciones de fila (actividad, nota, prioridad y los toggles SI/NO) se
 * acumulan LOCALES en `pendientes` — el checklist responde al instante sin
 * un request por clic. Se aplican en un solo lote con "Aplicar", o al
 * cerrar el modal (Listo/×/fondo) si el usuario confirma que quiere
 * aplicarlas — si hay pendientes sin confirmar, se pregunta antes de cerrar
 * (aplicar, descartar, o quedarse a seguir editando). Clic en el código →
 * vuela el mapa.
 */
export function ModalAsignaciones({ abierto, onCerrar }: Props) {
  const {
    asignaciones, cuadrillas, fecha,
    desasignar, desasignarCuadrilla, actualizarAsignaciones, actualizarLote,
    guardando, errorPlan,
  } = useAsignacionesStore()
  const { pozos, instalaciones, seleccionar } = useDatosStore()

  // Selección múltiple de filas (checkboxes), independiente de cuadrilla:
  // permite copiar Actividad/Nota a cualquier combinación de objetivos, no
  // solo a "toda la cuadrilla" (eso lo sigue cubriendo el botón ⧉ por fila).
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [actividadMulti, setActividadMulti] = useState('')
  const [notaMulti, setNotaMulti] = useState('')
  const [prioridadMulti, setPrioridadMulti] = useState('')
  const [exportando, setExportando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  /**
   * Ediciones locales aún no persistidas: id de asignación → campos
   * modificados. Lo que se ve en pantalla ya las incluye (asignacionesVista);
   * se confirman con "Aplicar" o al cerrar (Listo / × / fondo).
   */
  const [pendientes, setPendientes] = useState<Map<string, CamposAsignacion>>(new Map())
  const editar = (id: string, campos: CamposAsignacion) =>
    setPendientes((m) => {
      const n = new Map(m)
      n.set(id, { ...n.get(id), ...campos })
      return n
    })
  const quitarPendiente = (id: string) =>
    setPendientes((m) => {
      if (!m.has(id)) return m
      const n = new Map(m)
      n.delete(id)
      return n
    })

  // Vista "con lo editado": las filas, el orden, el Excel y el WhatsApp ven
  // los cambios pendientes tal como el usuario los dejó.
  const asignacionesVista = useMemo(
    () =>
      pendientes.size === 0
        ? asignaciones
        : asignaciones.map((a) => (pendientes.has(a.id) ? { ...a, ...pendientes.get(a.id) } : a)),
    [asignaciones, pendientes],
  )
  const aplicarPendientes = async (): Promise<boolean> => {
    if (pendientes.size === 0) return true
    const ok = await actualizarLote(pendientes)
    if (ok) setPendientes(new Map())
    return ok
  }
  /**
   * Al cerrar (Listo / × / fondo): si hay cambios sin aplicar, pregunta
   * antes de perderlos o guardarlos — ya no se aplican solos en silencio.
   * Aceptar = aplicar y cerrar (si falla, queda abierto con el error visible).
   * Cancelar del primer aviso = pregunta si descartarlos; cancelar el
   * segundo aviso = se queda en el modal sin cerrar.
   */
  const cerrar = async () => {
    if (pendientes.size === 0) {
      onCerrar()
      return
    }
    const aplicar = window.confirm(
      `Tienes ${pendientes.size} cambio(s) sin aplicar.\n\nAceptar = aplicarlos y cerrar.\nCancelar = elegir si descartarlos.`,
    )
    if (aplicar) {
      if (await aplicarPendientes()) onCerrar()
      return
    }
    const descartar = window.confirm(
      `¿Descartar los ${pendientes.size} cambio(s) sin aplicar y cerrar igual?`,
    )
    if (!descartar) return // se queda en el modal, nada cambia
    setPendientes(new Map())
    onCerrar()
  }

  // Cuadrillas plegadas (ahorra espacio con muchas asignaciones); '__huerfanos__'
  // es el sentinel del grupo "sin cuadrilla". Persiste mientras el modal
  // permanece montado, no se resetea al cerrar (es preferencia de vista).
  const [colapsados, setColapsados] = useState<Set<string>>(new Set())
  const alternarColapso = (id: string) =>
    setColapsados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // Limpia la selección al cerrar — el modal no se desmonta entre aperturas.
  // Ajuste de estado durante el render (patrón recomendado por React en vez
  // de un efecto) al detectar el cambio de la prop `abierto`.
  const [abiertoAntes, setAbiertoAntes] = useState(abierto)
  if (abierto !== abiertoAntes) {
    setAbiertoAntes(abierto)
    if (!abierto) {
      setMarcados(new Set())
      setPendientes(new Map())
    }
  }

  /**
   * GridApi de cada grilla por grupo (cuadrilla.id / '__huerfanos__') — para
   * deseleccionar desde fuera cuando se aplica o cancela la multi-selección.
   */
  const gridApis = useRef(new Map<string, GridApi>())
  const limpiarMarcados = () => {
    for (const api of gridApis.current.values()) if (!api.isDestroyed()) api.deselectAll()
    setMarcados(new Set())
  }
  /** La grilla de un grupo cambió su selección: se reemplazan sus ids en el set global. */
  const alSeleccionGrupo = (items: AsignacionRec[], ids: string[]) =>
    setMarcados((s) => {
      const n = new Set(s)
      for (const i of items) n.delete(i.id)
      for (const id of ids) n.add(id)
      return n
    })

  const coordsDe = useMemo(() => {
    const m = new Map<string, { lon: number; lat: number }>()
    for (const p of pozos) if (p.lon !== null && p.lat !== null) m.set(`pozo|${p.id}`, { lon: p.lon, lat: p.lat })
    for (const i of instalaciones) if (i.lon !== null && i.lat !== null) m.set(`inst|${i.id}`, { lon: i.lon, lat: i.lat })
    return m
  }, [pozos, instalaciones])

  /**
   * EF/MG/POT/BNPD por objetivo (mismos derivados que usa el mapa y el
   * exportador de Excel) — vacío/null para instalaciones o si el objetivo no
   * está en los datos cargados de esta sesión.
   */
  const detalleDe = useMemo(() => construirDetalleObjetivos(pozos, instalaciones), [pozos, instalaciones])

  // El orden de filas lo maneja la grilla (multi-sort con Ctrl+clic); aquí
  // solo se reparten las asignaciones por cuadrilla en orden de creación.
  const grupos = useMemo(
    () =>
      cuadrillas
        .map((c) => ({
          cuadrilla: c,
          items: asignacionesVista.filter((a) => a.fecha === fecha && a.cuadrillaId === c.id),
        }))
        .filter((g) => g.items.length > 0),
    [asignacionesVista, cuadrillas, fecha],
  )
  const huerfanos = useMemo(
    () =>
      asignacionesVista.filter(
        (a) => a.fecha === fecha && !cuadrillas.some((c) => c.id === a.cuadrillaId),
      ),
    [asignacionesVista, cuadrillas, fecha],
  )

  const exportar = async () => {
    setExportando(true)
    try {
      const ok = await exportarPlanExcel(fecha, cuadrillas, asignacionesVista, detalleDe)
      if (!ok) window.alert(`No hay pozos asignados para exportar el ${formatearFecha(fecha)}`)
    } finally {
      setExportando(false)
    }
  }

  const copiarWhatsApp = async () => {
    const msg = construirMensajeWhatsApp(fecha, cuadrillas, asignacionesVista, detalleDe)
    if (!msg) {
      window.alert(`No hay pozos asignados para copiar el ${formatearFecha(fecha)}`)
      return
    }
    try {
      await navigator.clipboard.writeText(msg)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      window.alert('No se pudo copiar al portapapeles')
    }
  }

  const irA = (objetivoId: IdObjetivo) => {
    const c = coordsDe.get(objetivoId)
    if (c) mapaInstancia.current?.flyTo({ center: [c.lon, c.lat], zoom: Math.max(mapaInstancia.current.getZoom(), 14) })
    const kind = objetivoId.startsWith('pozo|') ? 'pozo' : 'instalacion'
    seleccionar({ kind, id: objetivoId.slice(objetivoId.indexOf('|') + 1) })
  }

  if (!abierto) return null

  // Portal a body: el panel padre tiene overflow/z-index propios y el modal
  // quedaría atrapado en su contexto de apilado (tapado por otras capas).
  return createPortal(
    <div className="ma-fondo" onClick={() => void cerrar()}>
      <div className="ma-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ma-titulo">
          Asignaciones · {formatearFecha(fecha)}
          <button type="button" className="ma-cerrar" onClick={() => void cerrar()} aria-label="Cerrar">×</button>
        </div>

        {errorPlan && <div className="ma-error">{errorPlan}</div>}

        {marcados.size > 0 && (
          <div className="ma-barra-multi">
            <span className="ma-n-marcados">{marcados.size} seleccionados</span>
            <input
              className="ma-input"
              type="text"
              placeholder="Actividad"
              list="ma-actividades"
              value={actividadMulti}
              onChange={(e) => setActividadMulti(e.target.value)}
            />
            <input
              className="ma-input ma-input-nota"
              type="text"
              placeholder="Nota"
              value={notaMulti}
              onChange={(e) => setNotaMulti(e.target.value)}
            />
            <input
              className="ma-input ma-input-prioridad-multi"
              type="number"
              placeholder="Prior."
              title="Prioridad (número libre)"
              value={prioridadMulti}
              onChange={(e) => setPrioridadMulti(e.target.value)}
            />
            <button
              type="button"
              className="ma-aplicar-multi"
              disabled={guardando || (!actividadMulti.trim() && !notaMulti.trim() && !prioridadMulti.trim())}
              onClick={() => {
                const p = Number(prioridadMulti.trim())
                const campos: CamposAsignacion = {
                  actividad: actividadMulti.trim() || null,
                  nota: notaMulti.trim() || null,
                }
                // Prioridad solo se aplica si el campo tiene valor: vacío =
                // "no tocar" (a diferencia de texto, borrar prioridades de
                // muchas filas por un campo en blanco sería destructivo).
                if (prioridadMulti.trim() && Number.isFinite(p)) campos.prioridad = Math.trunc(p)
                void actualizarAsignaciones([...marcados], campos).then((ok) => {
                  if (ok) {
                    limpiarMarcados()
                    setActividadMulti('')
                    setNotaMulti('')
                    setPrioridadMulti('')
                  }
                })
              }}
            >
              Aplicar a selección
            </button>
            <button type="button" className="ma-cancelar-multi" onClick={limpiarMarcados}>
              Cancelar
            </button>
          </div>
        )}

        <div className="ma-cuerpo">
          {grupos.length === 0 && huerfanos.length === 0 && (
            <div className="ma-vacio">Nada asignado este día</div>
          )}
          {grupos.map(({ cuadrilla, items }) => {
            const plegado = colapsados.has(cuadrilla.id)
            return (
              <div key={cuadrilla.id} className="ma-grupo">
                <div className="ma-grupo-titulo">
                  <button
                    type="button"
                    className="ma-plegar"
                    title={plegado ? 'Desplegar' : 'Plegar'}
                    onClick={() => alternarColapso(cuadrilla.id)}
                  >
                    {plegado ? '▸' : '▾'}
                  </button>
                  <span className="ma-punto" style={{ background: cuadrilla.color }} />
                  {cuadrilla.nombre}
                  <button
                    type="button"
                    className="ma-limpiar-grupo"
                    title={`Desasignar sus ${items.length} objetivos del ${formatearFecha(fecha)}`}
                    disabled={guardando}
                    onClick={() => {
                      if (window.confirm(`¿Desasignar los ${items.length} objetivos de "${cuadrilla.nombre}" del ${formatearFecha(fecha)}?`)) {
                        const ids = new Set(items.map((i) => i.id))
                        setMarcados((s) => new Set([...s].filter((id) => !ids.has(id))))
                        void desasignarCuadrilla(cuadrilla.id)
                      }
                    }}
                  >
                    ⌫
                  </button>
                  <span className="ma-n">{items.length}</span>
                </div>
                {!plegado && (
                  <TablaAsignaciones
                    items={items}
                    detalleDe={detalleDe}
                    pendientes={pendientes}
                    deshabilitado={guardando}
                    onGridReady={(api) => gridApis.current.set(cuadrilla.id, api)}
                    onSeleccion={(ids) => alSeleccionGrupo(items, ids)}
                    onEditar={editar}
                    onIrA={irA}
                    onCopiarGrupo={(fila) => {
                      if (
                        items.length > 1 &&
                        window.confirm(
                          `¿Aplicar esta actividad/nota/prioridad a los ${items.length} objetivos de "${cuadrilla.nombre}"?`,
                        )
                      )
                        void actualizarAsignaciones(items.map((i) => i.id), {
                          actividad: fila.actividad,
                          nota: fila.nota,
                          prioridad: fila.prioridad,
                        })
                    }}
                    onDesasignar={(fila) => {
                      quitarPendiente(fila.id)
                      setMarcados((s) => {
                        if (!s.has(fila.id)) return s
                        const n = new Set(s)
                        n.delete(fila.id)
                        return n
                      })
                      void desasignar([fila.objetivoId])
                    }}
                  />
                )}
              </div>
            )
          })}
          {huerfanos.length > 0 && (
            <div className="ma-grupo">
              <div className="ma-grupo-titulo ma-huerfano">
                <button
                  type="button"
                  className="ma-plegar"
                  title={colapsados.has('__huerfanos__') ? 'Desplegar' : 'Plegar'}
                  onClick={() => alternarColapso('__huerfanos__')}
                >
                  {colapsados.has('__huerfanos__') ? '▸' : '▾'}
                </button>
                Sin cuadrilla ({huerfanos.length})
              </div>
              {!colapsados.has('__huerfanos__') && (
                <TablaAsignaciones
                  items={huerfanos}
                  detalleDe={detalleDe}
                  pendientes={pendientes}
                  deshabilitado={guardando}
                  onGridReady={(api) => gridApis.current.set('__huerfanos__', api)}
                  onSeleccion={(ids) => alSeleccionGrupo(huerfanos, ids)}
                  onEditar={editar}
                  onIrA={irA}
                  onCopiarGrupo={(fila) => {
                    if (
                      huerfanos.length > 1 &&
                      window.confirm(`¿Aplicar esta actividad/nota/prioridad a los ${huerfanos.length} objetivos sin cuadrilla?`)
                    )
                      void actualizarAsignaciones(huerfanos.map((i) => i.id), {
                        actividad: fila.actividad,
                        nota: fila.nota,
                        prioridad: fila.prioridad,
                      })
                  }}
                  onDesasignar={(fila) => {
                    quitarPendiente(fila.id)
                    setMarcados((s) => {
                      if (!s.has(fila.id)) return s
                      const n = new Set(s)
                      n.delete(fila.id)
                      return n
                    })
                    void desasignar([fila.objetivoId])
                  }}
                />
              )}
            </div>
          )}
        </div>

        <div className="ma-pie">
          <button
            type="button"
            className="ma-whatsapp"
            title="Copia el plan del día como mensaje de WhatsApp (pozos agrupados por campo y MG/EF)"
            onClick={() => void copiarWhatsApp()}
          >
            {copiado ? '¡Copiado!' : 'Copiar WhatsApp'}
          </button>
          <button
            type="button"
            className="ma-exportar"
            title="Genera un Excel con una hoja por cuadrilla (solo pozos) para imprimir"
            disabled={exportando}
            onClick={() => void exportar()}
          >
            {exportando ? 'Exportando…' : 'Exportar Excel'}
          </button>
          {pendientes.size > 0 && (
            <button
              type="button"
              className="ma-aplicar"
              title="Guarda en la base todas las ediciones hechas en el modal"
              disabled={guardando}
              onClick={() => void aplicarPendientes()}
            >
              {guardando ? 'Aplicando…' : `Aplicar (${pendientes.size})`}
            </button>
          )}
          <button type="button" className="ma-listo" onClick={() => void cerrar()}>Listo</button>
        </div>

        <datalist id="ma-actividades">
          {SUGERENCIAS_ACTIVIDAD.map((s) => <option key={s} value={s} />)}
        </datalist>
      </div>
    </div>,
    document.body,
  )
}
