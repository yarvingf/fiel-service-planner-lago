import { useMemo, useState } from 'react'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'
import { useAuthStore } from '@/state/authStore'
import { ModalAsignaciones } from './ModalAsignaciones'
import './PanelPlan.css'

/**
 * Menú lateral derecho: resumen numérico del plan del día.
 * La lista detallada (con actividad/nota/desasignar) vive en el modal —
 * aquí solo quedan los conteos para no saturar el HUD.
 */
export function PanelPlan() {
  const { cuadrillas, asignaciones, fecha, setFecha, colorPor, setColorPor, cargandoPlan, errorPlan } =
    useAsignacionesStore()
  const { pozos, instalaciones } = useDatosStore()
  const { perfil, salir } = useAuthStore()
  const [colapsado, setColapsado] = useState(false)
  const [modalPlan, setModalPlan] = useState(false)

  const delDia = useMemo(() => asignaciones.filter((a) => a.fecha === fecha), [asignaciones, fecha])
  const totalPozos = pozos.filter((p) => p.activo && !p.reemplazado).length

  const instPorId = useMemo(() => new Map(instalaciones.map((i) => [i.id, i])), [instalaciones])

  // Desglose de lo asignado en la fecha: pozos aparte, instalaciones por tipo.
  const desglose = useMemo(() => {
    let pozosN = 0
    const tipos = new Map<string, number>()
    for (const a of delDia) {
      if (a.objetivoId.startsWith('pozo|')) {
        pozosN++
        continue
      }
      const id = a.objetivoId.slice(a.objetivoId.indexOf('|') + 1)
      const tipo = instPorId.get(id)?.tipo ?? 'Inst'
      tipos.set(tipo, (tipos.get(tipo) ?? 0) + 1)
    }
    return { pozosN, tipos: [...tipos.entries()].sort((a, b) => a[0].localeCompare(b[0])) }
  }, [delDia, instPorId])

  return (
    <aside className={`panel-plan${colapsado ? ' pp-colapsado' : ''}`}>
      <div className="pp-header">
        <span className="pp-titulo">Plan de operaciones</span>
        {perfil && (
          <span className="pp-usuario" title={`${perfil.nombre} (${perfil.rol})`}>
            {perfil.nombre}
          </span>
        )}
        <button type="button" className="pp-toggle" title="Cerrar sesión" onClick={() => void salir()}>
          ⎋
        </button>
        <button
          type="button"
          className="pp-toggle"
          title={colapsado ? 'Expandir plan' : 'Colapsar plan'}
          onClick={() => setColapsado((v) => !v)}
        >
          {colapsado ? '▸' : '▾'}
        </button>
      </div>

      {!colapsado && (
        <>
          <div className="pp-controles">
            <label className="pp-fecha">
              Fecha
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="pp-color">
              <input
                type="checkbox"
                checked={colorPor === 'cuadrilla'}
                onChange={(e) => setColorPor(e.target.checked ? 'cuadrilla' : 'estatus')}
              />
              Colorear por cuadrilla
            </label>
          </div>

          <div className="pp-stats">
            <div className="pp-stat">
              <span className="pp-stat-n">{totalPozos}</span>
              <span className="pp-stat-l">pozos</span>
            </div>
            <div className="pp-stat">
              <span className="pp-stat-n">{instalaciones.length}</span>
              <span className="pp-stat-l">instal.</span>
            </div>
            <div className="pp-stat">
              <span className="pp-stat-n">{cuadrillas.length}</span>
              <span className="pp-stat-l">cuadrillas</span>
            </div>
            <div className="pp-stat pp-stat-destacado">
              <span className="pp-stat-n">{cargandoPlan ? '…' : delDia.length}</span>
              <span className="pp-stat-l">asignados</span>
            </div>
          </div>

          <button type="button" className="pp-detalle" onClick={() => setModalPlan(true)}>
            ✎ Asignaciones del día
          </button>

          {delDia.length > 0 && (
            <div className="pp-desglose">
              <span>Pozos <b>{desglose.pozosN}</b></span>
              {desglose.tipos.map(([t, n]) => (
                <span key={t}>{t} <b>{n}</b></span>
              ))}
            </div>
          )}

          {errorPlan && <div className="pp-error">{errorPlan}</div>}
        </>
      )}

      <ModalAsignaciones abierto={modalPlan} onCerrar={() => setModalPlan(false)} />
    </aside>
  )
}
