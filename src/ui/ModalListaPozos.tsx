import { useMemo, useState } from 'react'
import { useDatosStore } from '@/state/datosStore'
import { useAsignacionesStore, type IdObjetivo } from '@/state/asignacionesStore'
import { useAuthStore } from '@/state/authStore'
import { useFiltrosStore } from '@/state/filtrosStore'
import { extraerCodigosPozos } from '@/domain/parserCoa'
import { construirIndicePozos, resolverPozoPorCodigo } from '@/domain/resolverPozo'
import type { PozoConCompletaciones } from '@/domain/pozo'
import { mapaInstancia } from '@/map/mapaInstancia'
import './ModalCoa.css'

interface Props {
  onCerrar: () => void
}

interface FilaLista {
  /** Código tal como salió del parser. */
  detectado: string
  pozoId: string | null
  codigoReal: string | null
  /** 'fisico' = cayó al pozo activo por campo+número (texto sin letra de reemplazo). */
  via: 'exacto' | 'fisico' | null
}

const objetivoDe = (pozoId: string): IdObjetivo => `pozo|${pozoId}`

/**
 * Modal "Lista de pozos": pega cualquier texto (lista, mensaje, columna de
 * Excel copiada), el parser extrae los códigos BA/VLC/VLG, se resuelven contra
 * el universo y el usuario los selecciona en el mapa — desde ahí puede
 * asignarlos con la consola o la cuadrilla activa. Solo lectura sobre datos.
 */
export function ModalListaPozos({ onCerrar }: Props) {
  const { pozos } = useDatosStore()
  const { seleccion, agregarASeleccion, iniciarAsignacion, cuadrillaActiva, cuadrillas } =
    useAsignacionesStore()
  const setFiltros = useFiltrosStore((s) => s.setFiltros)
  // Rol 'consulta': "Asignar a…" es escritura — se oculta.
  const puedeEditar = useAuthStore((s) => s.perfil?.rol === 'planificador')
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState<FilaLista[] | null>(null)
  const [okMsg, setOkMsg] = useState('')

  const pozosPorId = useMemo(() => new Map(pozos.map((p) => [p.id, p])), [pozos])
  const selSet = useMemo(() => new Set(seleccion), [seleccion])
  const nombreActiva = cuadrillaActiva
    ? cuadrillas.find((c) => c.id === cuadrillaActiva)?.nombre
    : undefined

  const procesar = () => {
    const indice = construirIndicePozos(pozos)
    setFilas(
      extraerCodigosPozos(texto).map((codigo) => {
        const match = resolverPozoPorCodigo(codigo, indice)
        return {
          detectado: codigo,
          pozoId: match?.pozo.id ?? null,
          codigoReal: match?.pozo.codigo ?? null,
          via: match?.via ?? null,
        }
      }),
    )
    setOkMsg('')
  }

  /** Pozos aprovechables: resueltos y activos (no históricos/reemplazados). */
  const seleccionables = (filas ?? []).filter(
    (f) => f.pozoId && !pozosPorId.get(f.pozoId)?.reemplazado,
  )

  const estadoDe = (f: FilaLista): { clase: string; texto: string } => {
    const p = f.pozoId ? pozosPorId.get(f.pozoId) : undefined
    if (!p) return { clase: 'mc-nomatch', texto: 'sin match' }
    if (p.reemplazado) return { clase: 'mc-nomatch', texto: 'histórico' }
    if (selSet.has(objetivoDe(p.id))) return { clase: 'mc-igual', texto: 'en selección' }
    return { clase: 'mc-cambia', texto: 'listo' }
  }

  const enfocar = (ids: string[]) => {
    const map = mapaInstancia.current
    if (!map) return
    const pts = ids
      .map((id) => pozosPorId.get(id))
      .filter((p): p is PozoConCompletaciones => !!p && p.lat !== null && p.lon !== null)
      .map((p) => [p.lon!, p.lat!] as [number, number])
    if (pts.length === 0) return
    if (pts.length === 1) {
      map.flyTo({ center: pts[0], zoom: Math.max(map.getZoom(), 14.5), duration: 900 })
      return
    }
    const lons = pts.map((p) => p[0])
    const lats = pts.map((p) => p[1])
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 120, maxZoom: 14, duration: 1000 },
    )
  }

  const irA = (f: FilaLista) => {
    if (f.pozoId) enfocar([f.pozoId])
  }

  const seleccionar = () => {
    const ids = seleccionables.map((f) => f.pozoId!)
    agregarASeleccion(ids.map(objetivoDe))
    enfocar(ids)
    setOkMsg(`✓ ${ids.length} pozo(s) seleccionados`)
  }

  const seleccionarYAsignar = () => {
    const ids = seleccionables.map((f) => f.pozoId!)
    agregarASeleccion(ids.map(objetivoDe))
    iniciarAsignacion(ids.map(objetivoDe))
    onCerrar()
  }

  const mostrarSolo = () => {
    const ids = seleccionables.map((f) => f.pozoId!)
    setFiltros({ soloIds: ids })
    enfocar(ids)
    onCerrar()
  }

  return (
    <div className="mc-fondo" onClick={onCerrar}>
      <div className="mc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mc-titulo">
          Lista de pozos — pegar y seleccionar en el mapa
          <button type="button" className="mc-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <textarea
          className="mc-entrada"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pega la lista o el texto con los pozos… (reconoce códigos BA / VLC / VLG en cualquier línea)"
          rows={8}
        />
        <div className="mc-acciones">
          <button type="button" className="mc-boton mc-primario" onClick={procesar} disabled={!texto.trim()}>
            Procesar
          </button>
          <button
            type="button"
            className="mc-boton"
            onClick={() => { setTexto(''); setFilas(null); setOkMsg('') }}
          >
            Limpiar
          </button>
          <span className="mc-ayuda">Los pozos quedan en la selección del mapa</span>
        </div>

        {filas && (
          filas.length === 0 ? (
            <div className="mc-vacio">No se detectaron códigos de pozo en el texto.</div>
          ) : (
            <>
              <div className="mc-tabla-wrap">
                <table className="mc-tabla">
                  <thead>
                    <tr><th>Detectado</th><th>Pozo</th><th></th></tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => {
                      const e = estadoDe(f)
                      return (
                        <tr
                          key={i}
                          onClick={() => irA(f)}
                          style={f.pozoId ? { cursor: 'pointer' } : undefined}
                          title={f.pozoId ? 'Clic para centrar en el mapa' : undefined}
                        >
                          <td>{f.detectado}</td>
                          <td>
                            {f.codigoReal ?? '—'}
                            {f.via === 'fisico' && <span className="mc-via" title="Match por pozo físico (el texto no trae la letra de reemplazo)">→ reemplazo</span>}
                          </td>
                          <td><span className={`mc-estado ${e.clase}`}>{e.texto}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mc-pie">
                {okMsg && <span className="mc-ok">{okMsg}</span>}
                {puedeEditar && cuadrillaActiva && seleccionables.length > 0 && (
                  <button
                    type="button"
                    className="mc-boton"
                    onClick={seleccionarYAsignar}
                    title={`Selecciona y abre la asignación a ${nombreActiva ?? 'la cuadrilla activa'}`}
                  >
                    → Asignar a {nombreActiva ?? 'cuadrilla activa'}
                  </button>
                )}
                <button
                  type="button"
                  className="mc-boton"
                  disabled={seleccionables.length === 0}
                  title="Filtra el mapa para ver únicamente estos pozos (se quita desde el panel de filtros)"
                  onClick={mostrarSolo}
                >
                  Mostrar solo
                </button>
                <button
                  type="button"
                  className="mc-boton mc-primario"
                  disabled={seleccionables.length === 0}
                  onClick={seleccionar}
                >
                  Seleccionar {seleccionables.length} pozo(s)
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
