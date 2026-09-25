import { useState } from 'react'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { formatearFecha } from '@/domain/fecha'
import './PanelCuadrillas.css'

interface Props {
  abierto: boolean
  onCerrar: () => void
}

/** Modal para crear y gestionar cuadrillas (agregar / eliminar / ver carga del día). */
export function PanelCuadrillas({ abierto, onCerrar }: Props) {
  const { cuadrillas, asignaciones, fecha, agregarCuadrilla, quitarCuadrilla, desasignarCuadrilla, guardando, errorPlan } =
    useAsignacionesStore()
  const [nombre, setNombre] = useState('')

  if (!abierto) return null

  const crear = async () => {
    const n = nombre.trim()
    if (!n || guardando) return
    await agregarCuadrilla(n)
    // Si la base rechazó, conservar el texto para reintentar sin reescribirlo.
    if (!useAsignacionesStore.getState().errorPlan) setNombre('')
  }

  return (
    <div className="pc-fondo" onClick={onCerrar}>
      <div className="pc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pc-titulo">
          Cuadrillas
          <button type="button" className="pc-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <ul className="pc-lista">
          {cuadrillas.length === 0 && <li className="pc-vacia">Sin cuadrillas — crea la primera abajo</li>}
          {cuadrillas.map((c) => {
            const asignadas = asignaciones.filter((a) => a.cuadrillaId === c.id && a.fecha === fecha).length
            return (
              <li key={c.id} className="pc-item">
                <span className="pc-color" style={{ background: c.color }} />
                <span className="pc-nombre">{c.nombre}</span>
                <span className="pc-conteo">{asignadas} obj. hoy</span>
                {asignadas > 0 && (
                  <button
                    type="button"
                    className="pc-limpiar"
                    title={`Desasignar sus ${asignadas} objetivos del ${formatearFecha(fecha)}`}
                    disabled={guardando}
                    onClick={() => {
                      if (window.confirm(`¿Desasignar los ${asignadas} objetivos de "${c.nombre}" del ${formatearFecha(fecha)}?`))
                        void desasignarCuadrilla(c.id)
                    }}
                  >
                    ⌫
                  </button>
                )}
                <button
                  type="button"
                  className="pc-eliminar"
                  title="Eliminar cuadrilla (suelta sus asignaciones)"
                  disabled={guardando}
                  onClick={() => void quitarCuadrilla(c.id)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>

        {errorPlan && <div className="pc-error">{errorPlan}</div>}

        <div className="pc-nueva">
          <input
            type="text"
            value={nombre}
            placeholder="Nombre de la cuadrilla"
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void crear()}
          />
          <button type="button" className="pa-boton pa-asignar" disabled={guardando || !nombre.trim()} onClick={() => void crear()}>
            Crear
          </button>
        </div>
      </div>
    </div>
  )
}
