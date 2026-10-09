import { useEffect, useMemo, useState } from 'react'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { useAuthStore } from '@/state/authStore'
import {
  listarAsignaciones,
  ultimaFechaConPlan,
  type AsignacionRemota,
  type ItemCopiaPlan,
} from '@/data/persistencia'
import { formatearFecha } from '@/domain/fecha'
import './PanelAsignacion.css'

interface Props {
  onCerrar: () => void
}

/**
 * "Copiar plan de…": trae las asignaciones de otra fecha como PLANTILLA del
 * día actual. Antes de aplicar, el usuario revisa la lista agrupada por
 * cuadrilla y destilda lo que no quiera — un objetivo que ya tiene dueño hoy
 * viene destildado por defecto (marcarlo pisa esa asignación). Una vez
 * aplicada la plantilla se ajusta fino en el modal de asignaciones del día.
 */
export function ModalCopiarPlan({ onCerrar }: Props) {
  const { cuadrillas, asignaciones, fecha, guardando, errorPlan, aplicarCopiaPlan } =
    useAsignacionesStore()
  // Rol 'consulta': puede revisar la plantilla pero no aplicarla.
  const puedeEditar = useAuthStore((s) => s.perfil?.rol === 'planificador')

  const [fechaOrigen, setFechaOrigen] = useState('')
  const [origen, setOrigen] = useState<AsignacionRemota[] | null>(null)
  const [fechaCargada, setFechaCargada] = useState('')
  const [incluidos, setIncluidos] = useState<Set<string>>(new Set())

  // Al cambiar la fecha elegida se descarta la plantilla previa y el efecto
  // de abajo recarga — ajuste de estado durante el render (patrón de React),
  // `cargandoOrigen` se deriva: fecha elegida sin datos aún = cargando.
  if (fechaCargada !== fechaOrigen) {
    setFechaCargada(fechaOrigen)
    setOrigen(null)
  }
  const cargandoOrigen = fechaOrigen !== '' && origen === null

  const cuadrillaPorId = useMemo(() => new Map(cuadrillas.map((c) => [c.id, c])), [cuadrillas])
  /** objetivoId → cuadrilla que ya lo tiene asignado en la fecha actual. */
  const duenoHoy = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of asignaciones) {
      if (a.fecha === fecha) m.set(a.objetivoId, cuadrillaPorId.get(a.cuadrillaId)?.nombre ?? 'otra cuadrilla')
    }
    return m
  }, [asignaciones, fecha, cuadrillaPorId])

  // Al abrir: busca la fecha anterior más reciente con plan y la precarga.
  useEffect(() => {
    let vivo = true
    void ultimaFechaConPlan(fecha)
      .then((f) => {
        if (!vivo || !f) return
        setFechaOrigen(f)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [fecha])

  // Cada vez que cambia la fecha elegida, recarga la plantilla.
  useEffect(() => {
    if (!fechaOrigen) return
    let vivo = true
    void listarAsignaciones(fechaOrigen)
      .then((filas) => {
        if (!vivo) return
        setOrigen(filas)
        // Por defecto se copia todo lo sin conflicto; lo que ya tiene dueño
        // hoy queda destildado para no pisar el plan actual por accidente.
        setIncluidos(new Set(filas.filter((f) => !duenoHoy.has(f.objetivoId)).map((f) => f.objetivoId)))
      })
      .catch(() => {
        if (vivo) setOrigen([])
      })
    return () => { vivo = false }
  }, [fechaOrigen, duenoHoy])

  const grupos = useMemo(() => {
    const m = new Map<string, AsignacionRemota[]>()
    for (const a of origen ?? []) {
      const arr = m.get(a.cuadrillaId) ?? []
      arr.push(a)
      m.set(a.cuadrillaId, arr)
    }
    return [...m.entries()]
  }, [origen])

  const alternar = (id: string) =>
    setIncluidos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const aplicar = async () => {
    const items: ItemCopiaPlan[] = (origen ?? [])
      .filter((a) => incluidos.has(a.objetivoId))
      .map((a) => ({
        objetivoId: a.objetivoId,
        codigo: a.codigo,
        cuadrillaId: a.cuadrillaId,
        actividad: a.actividad,
        nota: a.nota,
        prioridad: a.prioridad,
        validarAjuste: a.validarAjuste,
        requiereManometro: a.requiereManometro,
        requiereNivel: a.requiereNivel,
      }))
    if (await aplicarCopiaPlan(items)) onCerrar()
  }

  return (
    <div className="pa-modal-fondo" onClick={onCerrar}>
      <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pa-modal-titulo">
          Copiar plan como plantilla
          <button type="button" className="pa-modal-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <div className="pa-modal-acciones-grupo">
          <label className="pa-copia-fecha">
            Plan de:
            <input
              type="date"
              value={fechaOrigen}
              max={fecha}
              onChange={(e) => setFechaOrigen(e.target.value)}
            />
          </label>
          {origen && origen.length > 0 && (
            <>
              <button type="button" onClick={() => setIncluidos(new Set(origen.map((a) => a.objetivoId)))}>
                Todos
              </button>
              <button type="button" onClick={() => setIncluidos(new Set())}>
                Ninguno
              </button>
            </>
          )}
        </div>

        {cargandoOrigen ? (
          <div className="pa-copia-vacio">Cargando…</div>
        ) : !origen || origen.length === 0 ? (
          <div className="pa-copia-vacio">
            {fechaOrigen ? `Sin asignaciones el ${formatearFecha(fechaOrigen)}.` : 'No hay días anteriores con plan.'}
          </div>
        ) : (
          <ul className="pa-modal-lista">
            {grupos.map(([cuadrillaId, filas]) => {
              const c = cuadrillaPorId.get(cuadrillaId)
              return (
                <li key={cuadrillaId} className="pa-copia-grupo">
                  <div className="pa-copia-cuadrilla">
                    <span className="pa-chip-punto" style={{ background: c?.color ?? '#94a3b8' }} />
                    {c?.nombre ?? 'cuadrilla eliminada'}
                  </div>
                  {filas.map((a) => {
                    const conflicto = duenoHoy.get(a.objetivoId)
                    // Archivada (borrado lógico) no recibe copias: se ve en
                    // el historial pero no se puede asignar a ella.
                    const sinCuadrilla = !c || !c.activa
                    return (
                      <label key={a.id} className="pa-copia-fila">
                        <input
                          type="checkbox"
                          checked={incluidos.has(a.objetivoId)}
                          disabled={sinCuadrilla}
                          onChange={() => alternar(a.objetivoId)}
                        />
                        <span className="pa-modal-codigo">{a.codigo}</span>
                        <span className="pa-copia-actividad">{a.actividad ?? ''}</span>
                        {conflicto && <span className="pa-copia-conflicto">⚠ hoy: {conflicto}</span>}
                        {sinCuadrilla && <span className="pa-copia-conflicto">⚠ {c ? 'cuadrilla archivada' : 'sin cuadrilla'}</span>}
                      </label>
                    )
                  })}
                </li>
              )
            })}
          </ul>
        )}

        {errorPlan && <div className="pa-error">{errorPlan}</div>}

        <div className="pa-modal-botones">
          <button type="button" className="pa-boton" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button
            type="button"
            className="pa-boton pa-asignar"
            disabled={!puedeEditar || guardando || incluidos.size === 0}
            title={puedeEditar ? undefined : 'Rol de consulta: solo lectura'}
            onClick={() => void aplicar()}
          >
            {guardando ? 'Copiando…' : `Aplicar ${incluidos.size} asignacion(es)`}
          </button>
        </div>
      </div>
    </div>
  )
}
