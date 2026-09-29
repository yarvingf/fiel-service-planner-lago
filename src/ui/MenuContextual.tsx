import { useEffect, useMemo, useRef, useState } from 'react'
import { useDatosStore } from '@/state/datosStore'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { calcularDerivadosPozo } from '@/domain/pozo'
import { NOMBRES_TIPO_INSTALACION } from '@/domain/instalacion'
import { EMOJI_ESTATUS } from '@/data/mensajeWhatsApp'
import { COLORES_ESTATUS } from '@/map/capasMarcadores'
import './MenuContextual.css'

export interface PosMenuContextual {
  x: number
  y: number
  kind: 'pozo' | 'instalacion'
  id: string
}

const ANCHO = 250
const ALTO_APROX = 230

/**
 * Menú de clic derecho sobre un pozo/instalación del mapa. Acciones directas
 * sin dejar el mapa: asignar a cuadrilla, añadir/quitar de la selección,
 * ver el detalle en el panel y copiar la línea WhatsApp del pozo.
 * Cierra con Esc, clic fuera, o al ejecutar una acción.
 */
export function MenuContextual({ x, y, kind, id, onCerrar }: PosMenuContextual & { onCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [elegirCuadrilla, setElegirCuadrilla] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const { pozos, instalaciones, seleccionar } = useDatosStore()
  const {
    seleccion, cuadrillas, cuadrillaActiva, fecha, asignaciones,
    alternarObjetivo, setCuadrillaActiva, iniciarAsignacion,
  } = useAsignacionesStore()

  const objetivoId = `${kind === 'pozo' ? 'pozo' : 'inst'}|${id}`
  const pozo = kind === 'pozo' ? pozos.find((p) => p.id === id) : undefined
  const inst = kind === 'instalacion' ? instalaciones.find((i) => i.id === id) : undefined
  const estatus = pozo ? calcularDerivadosPozo(pozo.completaciones).estatus : undefined
  const enSeleccion = seleccion.includes(objetivoId)

  const cuadrillaPorId = useMemo(() => new Map(cuadrillas.map((c) => [c.id, c])), [cuadrillas])
  const duenoId = asignaciones.find((a) => a.fecha === fecha && a.objetivoId === objetivoId)?.cuadrillaId
  const dueno = duenoId ? cuadrillaPorId.get(duenoId) : undefined
  const activa = cuadrillaActiva ? cuadrillaPorId.get(cuadrillaActiva) : undefined

  // Cierra con Esc o con cualquier clic fuera del menú.
  useEffect(() => {
    const alBajar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    const alClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCerrar()
    }
    window.addEventListener('keydown', alBajar)
    window.addEventListener('mousedown', alClick)
    return () => {
      window.removeEventListener('keydown', alBajar)
      window.removeEventListener('mousedown', alClick)
    }
  }, [onCerrar])

  if (!pozo && !inst) return null

  // El menú nunca se sale del viewport (ancha/alto aproximados).
  const left = Math.min(x, window.innerWidth - ANCHO - 8)
  const top = Math.min(y, window.innerHeight - ALTO_APROX - 8)

  const asignarA = (cuadrillaId: string) => {
    setCuadrillaActiva(cuadrillaId)
    iniciarAsignacion([objetivoId])
    onCerrar()
  }

  const copiarLinea = async () => {
    if (!pozo || !estatus) return
    try {
      await navigator.clipboard.writeText(`*${EMOJI_ESTATUS[estatus]} ${pozo.codigo}*`)
      setCopiado(true)
      setTimeout(onCerrar, 650)
    } catch {
      onCerrar()
    }
  }

  return (
    <div ref={ref} className="mc-menu" style={{ left, top }}>
      <div className="mc-cabecera">
        <span className="mc-codigo">{pozo?.codigo ?? inst?.codigo}</span>
        {estatus && (
          <span className="mc-badge" style={{ background: COLORES_ESTATUS[estatus] }}>{estatus}</span>
        )}
        {inst && <span className="mc-badge mc-badge-inst">{NOMBRES_TIPO_INSTALACION[inst.tipo] ?? inst.tipo}</span>}
      </div>

      {dueno && (
        <div className="mc-info">
          <span className="mc-punto" style={{ background: dueno.color }} />
          Hoy: {dueno.nombre}
        </div>
      )}

      {elegirCuadrilla ? (
        <div className="mc-cuadrillas">
          {cuadrillas.map((c) => (
            <button key={c.id} type="button" onClick={() => asignarA(c.id)}>
              <span className="mc-punto" style={{ background: c.color }} />
              {c.nombre}
            </button>
          ))}
          {cuadrillas.length === 0 && <span className="mc-vacio">Sin cuadrillas</span>}
        </div>
      ) : (
        <>
          {activa ? (
            <button
              type="button"
              className="mc-item"
              disabled={duenoId === activa.id}
              onClick={() => asignarA(activa.id)}
            >
              → {dueno && duenoId !== activa.id ? 'Reasignar' : 'Asignar'} a {activa.nombre}
              {dueno && duenoId !== activa.id && <span className="mc-detalle">(hoy: {dueno.nombre})</span>}
            </button>
          ) : (
            <button type="button" className="mc-item" onClick={() => setElegirCuadrilla(true)}>
              → Asignar a… <span className="mc-detalle">elegir cuadrilla</span>
            </button>
          )}

          <button type="button" className="mc-item" onClick={() => { alternarObjetivo(objetivoId); onCerrar() }}>
            {enSeleccion ? '✓ Quitar de la selección' : '⊕ Añadir a la selección'}
          </button>
        </>
      )}

      <button type="button" className="mc-item" onClick={() => { seleccionar({ kind, id }); onCerrar() }}>
        ⓘ Ver detalle
      </button>

      {pozo && (
        <button type="button" className="mc-item" onClick={() => void copiarLinea()}>
          {copiado ? '✓ Copiado' : '📋 Copiar línea WhatsApp'}
        </button>
      )}

      <button type="button" className="mc-item mc-cancelar" onClick={onCerrar}>
        ✕ Cancelar
      </button>
    </div>
  )
}
