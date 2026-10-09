import { useMemo, useState } from 'react'
import { useAsignacionesStore, PALETA_CUADRILLAS } from '@/state/asignacionesStore'
import { useAuthStore } from '@/state/authStore'
import { formatearFecha } from '@/domain/fecha'
import type { Cuadrilla } from '@/domain/cuadrilla'
import './PanelCuadrillas.css'

interface Props {
  abierto: boolean
  onCerrar: () => void
}

/** Campos operativos y su prefijo de nomenclatura: "CT #1", "BL #3". */
const CAMPOS = [
  { prefijo: 'CT', nombre: 'Ceuta Treco' },
  { prefijo: 'BL', nombre: 'Bachaquero Lago' },
] as const

type Prefijo = (typeof CAMPOS)[number]['prefijo']

const RE_NOMBRE = /^(CT|BL)\s*#(\d+)$/i

/** Agrupa cuadrillas por campo según su nomenclatura `CT #n` / `BL #n`;
   las que no siguen el patrón (creadas antes del rework) caen en "Otras". */
function agrupar(cuadrillas: Cuadrilla[]) {
  const grupos: Record<Prefijo, Cuadrilla[]> = { CT: [], BL: [] }
  const otras: Cuadrilla[] = []
  for (const c of cuadrillas) {
    const m = RE_NOMBRE.exec(c.nombre)
    if (m) grupos[m[1].toUpperCase() as Prefijo].push(c)
    else otras.push(c)
  }
  const porNumero = (a: Cuadrilla, b: Cuadrilla) =>
    Number(RE_NOMBRE.exec(a.nombre)?.[2] ?? 0) - Number(RE_NOMBRE.exec(b.nombre)?.[2] ?? 0)
  grupos.CT.sort(porNumero)
  grupos.BL.sort(porNumero)
  return { grupos, otras }
}

/**
 * Modal vertical de cuadrillas: dos agrupaciones por campo en grillas de
 * 3 columnas del mismo alto, y un formulario de creación tras "⚙ Configuración".
 */
export function PanelCuadrillas({ abierto, onCerrar }: Props) {
  const {
    cuadrillas, asignaciones, fecha, cuadrillaActiva,
    agregarCuadrilla, quitarCuadrilla, desasignarCuadrilla,
    setCuadrillaActiva, guardando, errorPlan,
  } = useAsignacionesStore()

  // Rol 'consulta': ve el listado pero no crea ni archiva cuadrillas.
  const puedeEditar = useAuthStore((s) => s.perfil?.rol === 'planificador')

  const [config, setConfig] = useState(false)
  const [campo, setCampo] = useState<Prefijo>('CT')
  const [numero, setNumero] = useState('')
  const [color, setColor] = useState('')
  const [errorLocal, setErrorLocal] = useState<string | null>(null)

  // Solo activas: las archivadas (borrado lógico) no aparecen — su
  // historial sigue vivo en las asignaciones pasadas.
  const { grupos, otras } = useMemo(
    () => agrupar(cuadrillas.filter((c) => c.activa)),
    [cuadrillas],
  )
  const conteoHoy = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of asignaciones) {
      if (a.fecha !== fecha) continue
      m.set(a.cuadrillaId, (m.get(a.cuadrillaId) ?? 0) + 1)
    }
    return m
  }, [asignaciones, fecha])

  if (!abierto) return null

  // Ambas grillas con el mismo alto: el número de filas lo manda la
  // agrupación más poblada (celdas vacías de la otra quedan como espacio).
  const filas = Math.max(
    1,
    ...[...Object.values(grupos), otras].map((g) => Math.ceil(g.length / 3)),
  )

  const crear = async () => {
    const n = Math.floor(Number(numero))
    if (!n || n < 1) {
      setErrorLocal('Número de cuadrilla inválido')
      return
    }
    const nombre = `${campo} #${n}`
    // Solo bloquea si la activa existe; con una archivada del mismo nombre
    // se reactiva en el store (mismo id → su historial se reconecta).
    if (cuadrillas.some((c) => c.activa && c.nombre.toUpperCase() === nombre.toUpperCase())) {
      setErrorLocal(`Ya existe ${nombre}`)
      return
    }
    setErrorLocal(null)
    await agregarCuadrilla(nombre, color || undefined)
    if (!useAsignacionesStore.getState().errorPlan) {
      setNumero('')
      setConfig(false)
    }
  }

  const celda = (c: Cuadrilla) => {
    const asignadas = conteoHoy.get(c.id) ?? 0
    const activa = cuadrillaActiva === c.id
    return (
      <button
        key={c.id}
        type="button"
        className={`pc-celda${activa ? ' pc-celda-activa' : ''}`}
        style={activa ? { borderColor: c.color, boxShadow: `0 0 0 1px ${c.color}` } : undefined}
        title={asignadas > 0 ? `${asignadas} objetivo(s) hoy` : 'Sin objetivos hoy'}
        onClick={() => {
          setCuadrillaActiva(activa ? null : c.id)
          onCerrar()
        }}
      >
        <span className="pc-celda-color" style={{ background: c.color }} />
        <span className="pc-celda-nombre">{c.nombre}</span>
        <span className="pc-celda-n">{asignadas || ''}</span>
        <span className="pc-celda-acciones">
          {puedeEditar && asignadas > 0 && (
            <span
              className="pc-celda-x"
              title={`Desasignar sus ${asignadas} objetivos del ${formatearFecha(fecha)}`}
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`¿Desasignar los ${asignadas} objetivos de "${c.nombre}" del ${formatearFecha(fecha)}?`))
                  void desasignarCuadrilla(c.id)
              }}
            >
              ⌫
            </span>
          )}
          {puedeEditar && <span
            className="pc-celda-x"
            title="Archivar cuadrilla (su historial se conserva)"
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`¿Eliminar la cuadrilla "${c.nombre}"? Quedará archivada y sus asignaciones históricas se conservan.`))
                void quitarCuadrilla(c.id)
            }}
          >
            ×
          </span>}
        </span>
      </button>
    )
  }

  const grupo = (titulo: string, lista: Cuadrilla[]) => (
    <div className="pc-grupo">
      <div className="pc-grupo-titulo">{titulo}</div>
      <div className="pc-grid" style={{ gridTemplateRows: `repeat(${filas}, 34px)` }}>
        {lista.length === 0 && <span className="pc-grupo-vacia">—</span>}
        {lista.map(celda)}
      </div>
    </div>
  )

  return (
    <div className="pc-fondo" onClick={onCerrar}>
      <div className="pc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pc-titulo">
          Cuadrillas
          <button type="button" className="pc-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        {!config ? (
          <>
            {puedeEditar && (
              <button type="button" className="pc-config" onClick={() => setConfig(true)}>
                ⚙ Configuración
              </button>
            )}

            {grupo('Ceuta Treco', grupos.CT)}
            <div className="pc-divisor" />
            {grupo('Bachaquero Lago', grupos.BL)}
            {otras.length > 0 && (
              <>
                <div className="pc-divisor" />
                {grupo('Otras', otras)}
              </>
            )}

            {errorPlan && <div className="pc-error">{errorPlan}</div>}
          </>
        ) : (
          <div className="pc-form">
            <div className="pc-form-titulo">Nueva cuadrilla</div>
            <label className="pc-form-campo">
              Campo
              <select value={campo} onChange={(e) => setCampo(e.target.value as Prefijo)}>
                {CAMPOS.map((c) => (
                  <option key={c.prefijo} value={c.prefijo}>{c.nombre}</option>
                ))}
              </select>
            </label>
            <label className="pc-form-campo">
              Número
              <input
                type="number"
                min={1}
                step={1}
                value={numero}
                placeholder="1"
                onChange={(e) => setNumero(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void crear()}
              />
            </label>
            <label className="pc-form-campo">
              Color
              <input
                type="color"
                value={color || PALETA_CUADRILLAS[cuadrillas.length % PALETA_CUADRILLAS.length]}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <div className="pc-form-preview">
              Nombre: <b>{campo} #{numero || '?'}</b>
            </div>
            {(errorLocal ?? errorPlan) && <div className="pc-error">{errorLocal ?? errorPlan}</div>}
            <div className="pc-form-botones">
              <button type="button" className="pc-boton" onClick={() => { setConfig(false); setErrorLocal(null) }}>
                Cancelar
              </button>
              <button
                type="button"
                className="pc-boton pc-primario"
                disabled={guardando || !numero.trim()}
                onClick={() => void crear()}
              >
                Agregar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
