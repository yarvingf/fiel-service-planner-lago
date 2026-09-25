import { useEffect, useState } from 'react'
import { useAsignacionesStore, type ModoSeleccion } from '@/state/asignacionesStore'
import './SeleccionMenu.css'

interface Herramienta {
  valor: ModoSeleccion
  icono: string
  label: string
  atajo?: string
}

const HERRAMIENTAS: Herramienta[] = [
  { valor: false, icono: '↖', label: 'Normal — navegación y arrastre' },
  { valor: 'rectangle', icono: '▭', label: 'Rectángulo', atajo: 'Mayús + clic' },
  { valor: 'freehand', icono: '◌', label: 'Lazo', atajo: 'Alt + clic' },
  { valor: 'multi', icono: '⊕', label: 'Multi-clic', atajo: 'Ctrl + clic' },
]

/** Las de "usar una vez" del menú contextual: todas menos Normal. */
const HERRAMIENTAS_UNA_VEZ = HERRAMIENTAS.filter((h) => h.valor !== false)

/**
 * Barra de herramientas de selección: 4 botones de solo ícono (el nombre
 * aparece como tooltip nativo al hover). Tres formas de activarlas:
 * - Clic en el botón: modo "pegajoso", queda activo hasta que elijas otro.
 * - Mantener Ctrl/Mayús/Alt: activa esa herramienta mientras la tecla esté
 *   presionada (ver atajos en MapaBase.tsx), y vuelve sola al soltarla.
 * - Clic derecho sobre la barra: menú para elegir una herramienta "de un
 *   solo uso" — se autoconsume tras completar una selección.
 */
export function HerramientaMenu() {
  const { modoSeleccion, modoUnaVez, setModoSeleccion, activarModoUnaVez } = useAsignacionesStore()
  const [menuContextual, setMenuContextual] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menuContextual) return
    const cerrar = () => setMenuContextual(null)
    window.addEventListener('keydown', cerrar)
    return () => window.removeEventListener('keydown', cerrar)
  }, [menuContextual])

  return (
    <div
      className="herr-grupo"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuContextual({ x: e.clientX, y: e.clientY })
      }}
    >
      {HERRAMIENTAS.map((h) => (
        <button
          key={String(h.valor)}
          type="button"
          className={`herr-boton${modoSeleccion === h.valor ? ' herr-boton-activo' : ''}${
            modoSeleccion === h.valor && modoUnaVez ? ' herr-boton-unavez' : ''
          }`}
          title={h.atajo ? `${h.label} (${h.atajo})` : h.label}
          aria-label={h.label}
          onClick={() => setModoSeleccion(h.valor)}
        >
          {h.icono}
        </button>
      ))}

      {menuContextual && (
        <>
          <div className="sel-fondo" onClick={() => setMenuContextual(null)} />
          <div
            className="sel-dropdown herr-contextual"
            style={{ left: menuContextual.x, top: menuContextual.y }}
          >
            <div className="sel-titulo">Usar una vez</div>
            <div className="sel-modos">
              {HERRAMIENTAS_UNA_VEZ.map((h) => (
                <button
                  key={String(h.valor)}
                  type="button"
                  className="sel-modo"
                  onClick={() => {
                    activarModoUnaVez(h.valor)
                    setMenuContextual(null)
                  }}
                >
                  <span className="sel-modo-icono">{h.icono}</span>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
