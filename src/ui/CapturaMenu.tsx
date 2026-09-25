import { useMemo, useState } from 'react'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { useDatosStore } from '@/state/datosStore'
import { NOMBRES_TIPO_INSTALACION } from '@/domain/instalacion'
import './SeleccionMenu.css'

/**
 * Configura qué captura la selección (rectángulo/lazo/multi): dropdown tipo
 * Excel con checkboxes — Pozos + cada tipo de instalación presente.
 */
export function CapturaMenu() {
  const { captura, setCaptura } = useAsignacionesStore()
  const instalaciones = useDatosStore((s) => s.instalaciones)
  const [abierto, setAbierto] = useState(false)

  const tipos = useMemo(
    () => [...new Set(instalaciones.map((i) => i.tipo))].sort(),
    [instalaciones],
  )

  const todas = captura.tiposInst === null
  const marcadas = captura.tiposInst?.length ?? tipos.length

  const etiqueta =
    !captura.pozos && marcadas === 0 ? 'Nada'
    : captura.pozos && todas ? 'Todo'
    : !captura.pozos && todas ? 'Solo inst.'
    : captura.pozos && marcadas === 0 ? 'Solo pozos'
    : `${captura.pozos ? 'Pozos' : ''}${captura.pozos && marcadas > 0 ? ' + ' : ''}${marcadas > 0 ? `${marcadas} tipo${marcadas > 1 ? 's' : ''}` : ''}`

  const alternarTipo = (t: string) => {
    const actual = captura.tiposInst ?? tipos
    const nuevo = actual.includes(t) ? actual.filter((x) => x !== t) : [...actual, t]
    setCaptura({ ...captura, tiposInst: nuevo.length === tipos.length ? null : nuevo })
  }

  return (
    <div className="sel-menu">
      <button
        type="button"
        className={`bh-boton${abierto ? ' bh-boton-activo' : ''}`}
        title="Qué captura la selección"
        onClick={() => setAbierto((v) => !v)}
      >
        Captura: {etiqueta} ▾
      </button>
      {abierto && (
        <>
          <div className="sel-fondo" onClick={() => setAbierto(false)} />
          <div className="sel-dropdown">
            <div className="sel-titulo">Qué captura</div>
            <label className="sel-item sel-item-principal">
              <input
                type="checkbox"
                checked={captura.pozos}
                onChange={(e) => setCaptura({ ...captura, pozos: e.target.checked })}
              />
              Pozos
            </label>
            <label className="sel-item sel-item-principal">
              <input
                type="checkbox"
                checked={todas}
                onChange={(e) => setCaptura({ ...captura, tiposInst: e.target.checked ? null : [] })}
              />
              Todas las instalaciones
            </label>
            <div className="sel-tipos">
              {tipos.map((t) => (
                <label key={t} className="sel-item">
                  <input
                    type="checkbox"
                    checked={todas || captura.tiposInst!.includes(t)}
                    onChange={() => alternarTipo(t)}
                  />
                  {t} — {NOMBRES_TIPO_INSTALACION[t] ?? t}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
