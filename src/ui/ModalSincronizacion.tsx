import { useMemo, useState } from 'react'
import { useDatosStore } from '@/state/datosStore'
import type { CambioEntidad } from '@/data/sincronizarUniverso'
import './ModalSincronizacion.css'

const ETIQUETA_ENTIDAD: Record<CambioEntidad['entidad'], string> = {
  instalacion: 'Instalación',
  pozo: 'Pozo',
  completacion: 'Completación',
  visita: 'Visita',
}
const ETIQUETA_TIPO: Record<CambioEntidad['tipo'], string> = {
  nuevo: 'Nuevo',
  actualizado: 'Actualizado',
  desactivado: 'Desactivado',
  eliminado: 'Eliminado',
}

/**
 * Preview del diff antes de escribir en Supabase: qué se agregó, qué cambió
 * campo por campo y qué desapareció del Excel. El usuario (planificador)
 * supervisa y confirma o cancela — nada se aplica sin este paso.
 */
export function ModalSincronizacion() {
  const pend = useDatosStore((s) => s.sincPendiente)
  const sincronizando = useDatosStore((s) => s.sincronizando)
  const error = useDatosStore((s) => s.error)
  const confirmar = useDatosStore((s) => s.confirmarSincronizacion)
  const cancelar = useDatosStore((s) => s.cancelarSincronizacion)
  const [filtro, setFiltro] = useState<CambioEntidad['tipo'] | 'todos'>('todos')

  const cambiosVisibles = useMemo(() => {
    if (!pend) return []
    return filtro === 'todos' ? pend.diff.cambios : pend.diff.cambios.filter((c) => c.tipo === filtro)
  }, [pend, filtro])

  if (!pend) return null
  const d = pend.diff

  const resumen: { tipo: CambioEntidad['tipo'] | 'todos'; n: number; etiqueta: string }[] = [
    { tipo: 'todos', n: d.cambios.length, etiqueta: 'Todos' },
    { tipo: 'nuevo', n: d.instNuevas.length + d.pozosNuevos.length + d.compsNuevas.length + d.visitasNuevas.length, etiqueta: 'Nuevos' },
    { tipo: 'actualizado', n: d.instActualizadas.length + d.pozosActualizados.length + d.compsActualizadas.length + d.visitasActualizadas.length, etiqueta: 'Actualizados' },
    { tipo: 'desactivado', n: d.instDesactivadas.length + d.pozosDesactivados.length, etiqueta: 'Desactivados' },
    { tipo: 'eliminado', n: d.compsEliminadas.length, etiqueta: 'Eliminados' },
  ]

  return (
    <div className="ms-fondo">
      <div className="ms-modal">
        <div className="ms-titulo">
          Sincronizar "{pend.archivo}"
          <button type="button" className="ms-cerrar" onClick={cancelar} aria-label="Cerrar">×</button>
        </div>

        {d.vacio ? (
          <div className="ms-vacio">Sin cambios respecto a lo ya guardado en Supabase.</div>
        ) : (
          <>
            <div className="ms-chips">
              {resumen.map((r) => (
                <button
                  key={r.tipo}
                  type="button"
                  className={`ms-chip${filtro === r.tipo ? ' ms-chip-activo' : ''}`}
                  disabled={r.n === 0}
                  onClick={() => setFiltro(r.tipo)}
                >
                  {r.etiqueta} ({r.n})
                </button>
              ))}
            </div>

            <div className="ms-lista">
              {cambiosVisibles.length === 0 && <div className="ms-vacio">Sin cambios de este tipo.</div>}
              {cambiosVisibles.map((c, i) => (
                <div key={i} className={`ms-fila ms-fila-${c.tipo}`}>
                  <span className="ms-entidad">{ETIQUETA_ENTIDAD[c.entidad]}</span>
                  <span className="ms-clave">{c.clave}</span>
                  <span className="ms-tipo">{ETIQUETA_TIPO[c.tipo]}</span>
                  {c.campos && c.campos.length > 0 && (
                    <span className="ms-detalle">
                      {c.campos.map((f) => `${f.campo}: ${f.antes ?? '—'} → ${f.despues ?? '—'}`).join(' · ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {pend.nAlertas > 0 && (
          <div className="ms-alerta-parseo">
            El Excel generó {pend.nAlertas} alerta(s) de import — descárgalas con el botón "Alertas" tras confirmar.
          </div>
        )}
        {error && <div className="ms-error">{error}</div>}

        <div className="ms-pie">
          <button type="button" className="ms-cancelar" onClick={cancelar} disabled={sincronizando}>
            Cancelar
          </button>
          <button
            type="button"
            className="ms-confirmar"
            onClick={() => void confirmar()}
            disabled={sincronizando || d.vacio}
          >
            {sincronizando ? 'Aplicando…' : `Aplicar (${d.cambios.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
