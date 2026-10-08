import { useMemo, useState } from 'react'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { formatearFecha } from '@/domain/fecha'
import { PanelCuadrillas } from './PanelCuadrillas'
import { ModalCopiarPlan } from './ModalCopiarPlan'
import './PanelAsignacion.css'

export function PanelAsignacion() {
  const {
    cuadrillas, asignaciones, fecha, seleccion, cuadrillaActiva,
    asignacionPendiente, resoluciones,
    setSeleccion, guardando, errorPlan,
    limpiarSeleccion, iniciarAsignacion, setResolucion, resolverTodos,
    cancelarAsignacionPendiente, confirmarAsignacionPendiente, desasignar,
  } = useAsignacionesStore()

  const [modalCuadrillas, setModalCuadrillas] = useState(false)
  const [modalCopiar, setModalCopiar] = useState(false)

  const asignadasHoy = useMemo(
    () => new Set(asignaciones.filter((a) => a.fecha === fecha).map((a) => a.objetivoId)),
    [asignaciones, fecha],
  )

  const pozosSel = seleccion.filter((id) => id.startsWith('pozo|')).length
  const instSel = seleccion.length - pozosSel
  const activa = cuadrillas.find((c) => c.id === cuadrillaActiva)

  return (
    <>
      <div className="panel-asignacion">
        <button
          type="button"
          className="pa-cuadrillas-btn"
          title="Abrir panel de cuadrillas"
          onClick={() => setModalCuadrillas(true)}
        >
          {activa && <span className="pa-chip-punto" style={{ background: activa.color }} />}
          {activa ? activa.nombre : '👥 Cuadrillas'}
          <span className="pa-btn-flecha">▾</span>
        </button>

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
            onClick={() => iniciarAsignacion()}
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
          <button
            type="button"
            className="pa-boton"
            title="Traer el plan de otro día como plantilla (revisas antes de aplicar)"
            disabled={guardando}
            onClick={() => setModalCopiar(true)}
          >
            Copiar plan
          </button>
          <button type="button" className="pa-boton" disabled={seleccion.length === 0} onClick={() => setSeleccion([])}>
            Limpiar
          </button>
        </div>
      </div>

      {asignacionPendiente && (
        <div className="pa-modal-fondo" onClick={cancelarAsignacionPendiente}>
          <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pa-modal-titulo">
              {asignacionPendiente.conflictos.length} ya asignados a otra cuadrilla el {formatearFecha(fecha)}
            </div>
            <div className="pa-modal-acciones-grupo">
              <button type="button" onClick={() => resolverTodos('reasignar')}>
                Reasignar todos
              </button>
              <button type="button" onClick={() => resolverTodos('omitir')}>
                Omitir todos
              </button>
            </div>
            <ul className="pa-modal-lista">
              {asignacionPendiente.conflictos.map((c) => (
                <li key={c.objetivoId}>
                  <span className="pa-modal-codigo">{c.codigo}</span>
                  <span className="pa-modal-actual">→ {c.cuadrillaActual}</span>
                  <label><input type="radio" checked={resoluciones[c.objetivoId] === 'reasignar'} onChange={() => setResolucion(c.objetivoId, 'reasignar')} /> Reasignar</label>
                  <label><input type="radio" checked={resoluciones[c.objetivoId] === 'omitir'} onChange={() => setResolucion(c.objetivoId, 'omitir')} /> Omitir</label>
                </li>
              ))}
            </ul>
            <div className="pa-modal-botones">
              <button type="button" className="pa-boton" onClick={cancelarAsignacionPendiente}>Cancelar</button>
              <button type="button" className="pa-boton pa-asignar" onClick={() => void confirmarAsignacionPendiente()}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      <PanelCuadrillas abierto={modalCuadrillas} onCerrar={() => setModalCuadrillas(false)} />
      {modalCopiar && <ModalCopiarPlan onCerrar={() => setModalCopiar(false)} />}
    </>
  )
}
