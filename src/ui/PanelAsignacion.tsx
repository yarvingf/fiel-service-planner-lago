import { useMemo, useState } from 'react'
import { useAsignacionesStore, type ResolucionConflicto, type IdObjetivo } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'
import { formatearFecha } from '@/domain/fecha'
import { PanelCuadrillas } from './PanelCuadrillas'
import './PanelAsignacion.css'

interface ConflictoUI {
  objetivoId: IdObjetivo
  codigo: string
  cuadrillaActual: string
}

export function PanelAsignacion() {
  const {
    cuadrillas, asignaciones, fecha, seleccion,
    setSeleccion, guardando, errorPlan,
    limpiarSeleccion, conflictos, asignar, desasignar,
  } = useAsignacionesStore()
  const { pozos, instalaciones } = useDatosStore()

  const [cuadrillaActiva, setCuadrillaActiva] = useState<string | null>(null)
  const [modalCuadrillas, setModalCuadrillas] = useState(false)
  const [pendientes, setPendientes] = useState<ConflictoUI[] | null>(null)
  const [resoluciones, setResoluciones] = useState<Record<IdObjetivo, ResolucionConflicto>>({})

  const cuadrillaPorId = useMemo(() => new Map(cuadrillas.map((c) => [c.id, c])), [cuadrillas])
  const codigoDe = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of pozos) m.set(`pozo|${p.id}`, p.codigo)
    for (const i of instalaciones) m.set(`inst|${i.id}`, i.codigo)
    return m
  }, [pozos, instalaciones])

  const asignadasHoy = useMemo(
    () => new Set(asignaciones.filter((a) => a.fecha === fecha).map((a) => a.objetivoId)),
    [asignaciones, fecha],
  )

  const iniciarAsignacion = () => {
    if (!cuadrillaActiva || seleccion.length === 0) return
    const conf = conflictos(cuadrillaActiva)
    if (conf.length === 0) {
      void asignar(cuadrillaActiva, {})
      return
    }
    setPendientes(
      conf.map((a) => ({
        objetivoId: a.objetivoId,
        codigo: codigoDe.get(a.objetivoId) ?? a.codigo,
        cuadrillaActual: cuadrillaPorId.get(a.cuadrillaId)?.nombre ?? 'otra cuadrilla',
      })),
    )
    // Por defecto se omiten: nadie pierde su plan sin confirmarlo explícitamente
    setResoluciones(Object.fromEntries(conf.map((a) => [a.objetivoId, 'omitir' as const])))
  }

  const confirmarAsignacion = () => {
    if (!cuadrillaActiva) return
    // Si la base rechaza, el modal queda abierto para reintentar.
    void asignar(cuadrillaActiva, resoluciones).then((ok) => {
      if (ok) setPendientes(null)
    })
  }

  const pozosSel = seleccion.filter((id) => id.startsWith('pozo|')).length
  const instSel = seleccion.length - pozosSel

  return (
    <>
      <div className="panel-asignacion">
        <div className="pa-cuadrillas">
          <span className="pa-etiqueta">Cuadrillas</span>
          {cuadrillas.length === 0 && <span className="pa-sin-cuadrillas">ninguna creada</span>}
          {cuadrillas.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`pa-chip${cuadrillaActiva === c.id ? ' pa-chip-activa' : ''}`}
              style={cuadrillaActiva === c.id ? { borderColor: c.color, background: c.color, color: '#0b1220' } : { borderColor: c.color, color: c.color }}
              onClick={() => setCuadrillaActiva(cuadrillaActiva === c.id ? null : c.id)}
            >
              <span className="pa-chip-punto" style={{ background: c.color }} />
              {c.nombre}
            </button>
          ))}
          <button
            type="button"
            className="pa-gestion"
            title="Crear y gestionar cuadrillas"
            onClick={() => setModalCuadrillas(true)}
          >
            ⚙
          </button>
        </div>

        <div className="pa-separador" />

        <div className="pa-acciones">
          {errorPlan ? (
            <span className="pa-error" title={errorPlan}>⚠ {errorPlan}</span>
          ) : (
            <span className="pa-contador">
              {guardando
                ? 'Guardando…'
                : seleccion.length === 0
                  ? 'Sin selección'
                  : `${pozosSel} pozos${instSel > 0 ? ` · ${instSel} inst.` : ''}`}
            </span>
          )}
          <button
            type="button"
            className="pa-boton pa-asignar"
            disabled={guardando || !cuadrillaActiva || seleccion.length === 0}
            onClick={iniciarAsignacion}
          >
            Asignar
          </button>
          <button
            type="button"
            className="pa-boton"
            disabled={guardando || !seleccion.some((id) => asignadasHoy.has(id))}
            onClick={() => {
              void desasignar(seleccion).then((ok) => {
                if (ok) limpiarSeleccion()
              })
            }}
          >
            Desasignar
          </button>
          <button type="button" className="pa-boton" disabled={seleccion.length === 0} onClick={() => setSeleccion([])}>
            Limpiar
          </button>
        </div>
      </div>

      {pendientes && (
        <div className="pa-modal-fondo" onClick={() => setPendientes(null)}>
          <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pa-modal-titulo">
              {pendientes.length} ya asignados a otra cuadrilla el {formatearFecha(fecha)}
            </div>
            <div className="pa-modal-acciones-grupo">
              <button type="button" onClick={() => setResoluciones(Object.fromEntries(pendientes.map((c) => [c.objetivoId, 'reasignar' as const])))}>
                Reasignar todos
              </button>
              <button type="button" onClick={() => setResoluciones(Object.fromEntries(pendientes.map((c) => [c.objetivoId, 'omitir' as const])))}>
                Omitir todos
              </button>
            </div>
            <ul className="pa-modal-lista">
              {pendientes.map((c) => (
                <li key={c.objetivoId}>
                  <span className="pa-modal-codigo">{c.codigo}</span>
                  <span className="pa-modal-actual">→ {c.cuadrillaActual}</span>
                  <label><input type="radio" checked={resoluciones[c.objetivoId] === 'reasignar'} onChange={() => setResoluciones((r) => ({ ...r, [c.objetivoId]: 'reasignar' }))} /> Reasignar</label>
                  <label><input type="radio" checked={resoluciones[c.objetivoId] === 'omitir'} onChange={() => setResoluciones((r) => ({ ...r, [c.objetivoId]: 'omitir' }))} /> Omitir</label>
                </li>
              ))}
            </ul>
            <div className="pa-modal-botones">
              <button type="button" className="pa-boton" onClick={() => setPendientes(null)}>Cancelar</button>
              <button type="button" className="pa-boton pa-asignar" onClick={confirmarAsignacion}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      <PanelCuadrillas abierto={modalCuadrillas} onCerrar={() => setModalCuadrillas(false)} />
    </>
  )
}
