import { useMemo, useState } from 'react'
import { useDatosStore } from '@/state/datosStore'
import { parsearMensajeCoa, type EstatusMensaje } from '@/domain/parserCoa'
import { calcularDerivadosPozo, type EstatusCoa } from '@/domain/pozo'
import { construirIndicePozos, resolverPozoPorCodigo } from '@/domain/resolverPozo'
import './ModalCoa.css'

interface Props {
  onCerrar: () => void
}

interface FilaCoa {
  /** Código tal como salió del parser. */
  detectado: string
  estatus: EstatusMensaje
  /** Pozo del universo resuelto, o null si no existe. */
  pozoId: string | null
  /** Código real del pozo resuelto (puede diferir del detectado si cayó por reemplazo). */
  codigoReal: string | null
  /** 'exacto' = mismo código; 'fisico' = mismo pozo físico con otra letra de reemplazo. */
  via: 'exacto' | 'fisico' | null
}

/**
 * Modal "Estatus COA": pega el mensaje operativo (🟢 abierto / 🔴 cerrado),
 * se parsea a una tabla pozo→estatus, se cruza contra el universo y el
 * usuario aplica los cambios — que marcan todas las completaciones del pozo
 * y persisten en Supabase con coa_origen='mensaje'. Port del módulo
 * independiente "PozosA-C COA" integrado al flujo del plan.
 */
export function ModalCoa({ onCerrar }: Props) {
  const { pozos, aplicarEstatusCoa } = useDatosStore()
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState<FilaCoa[] | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const [okMsg, setOkMsg] = useState('')
  const [copiado, setCopiado] = useState(false)
  const error = useDatosStore((s) => s.error)

  const pozosPorId = useMemo(() => new Map(pozos.map((p) => [p.id, p])), [pozos])

  const procesar = () => {
    const indice = construirIndicePozos(pozos)
    setFilas(
      parsearMensajeCoa(texto).map((d) => {
        const match = resolverPozoPorCodigo(d.codigo, indice)
        return {
          detectado: d.codigo,
          estatus: d.estatus,
          pozoId: match?.pozo.id ?? null,
          codigoReal: match?.pozo.codigo ?? null,
          via: match?.via ?? null,
        }
      }),
    )
    setOkMsg('')
  }

  /** Estado de la fila leyendo el estatus ACTUAL del store (se recalcula tras aplicar). */
  const estadoDe = (f: FilaCoa): { actual: EstatusCoa | null; clase: string; texto: string } => {
    const p = f.pozoId ? pozosPorId.get(f.pozoId) : undefined
    if (!p) return { actual: null, clase: 'mc-nomatch', texto: 'sin match' }
    if (p.completaciones.length === 0) return { actual: null, clase: 'mc-nomatch', texto: 'sin arenas' }
    const actual = calcularDerivadosPozo(p.completaciones).estatus
    if (actual === f.estatus) return { actual, clase: 'mc-igual', texto: 'igual' }
    return { actual, clase: 'mc-cambia', texto: 'cambia' }
  }

  const cambios = (filas ?? []).filter((f) => estadoDe(f).clase === 'mc-cambia')

  const aplicar = async () => {
    setAplicando(true)
    const ok = await aplicarEstatusCoa(
      cambios.map((f) => ({ pozoId: f.pozoId!, estatus: f.estatus })),
    )
    setAplicando(false)
    if (ok) setOkMsg(`✓ ${cambios.length} pozo(s) actualizados`)
  }

  const copiarTabla = () => {
    const tsv =
      'Pozo\tEstatus\n' + (filas ?? []).map((f) => `${f.codigoReal ?? f.detectado}\t${f.estatus}`).join('\n')
    void navigator.clipboard.writeText(tsv).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  return (
    <div className="mc-fondo" onClick={onCerrar}>
      <div className="mc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mc-titulo">
          Estatus COA — mensaje operativo
          <button type="button" className="mc-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <textarea
          className="mc-entrada"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pega aquí el mensaje… (solo cuentan líneas que empiezan con 🟢 o 🔴)"
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
          <span className="mc-ayuda">🟢 Abierto · 🔴 Cerrado</span>
        </div>

        {filas && (
          filas.length === 0 ? (
            <div className="mc-vacio">No se detectaron pozos en el mensaje.</div>
          ) : (
            <>
              <div className="mc-tabla-wrap">
                <table className="mc-tabla">
                  <thead>
                    <tr><th>Detectado</th><th>Pozo</th><th>Actual</th><th>Nuevo</th><th></th></tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => {
                      const e = estadoDe(f)
                      return (
                        <tr key={i}>
                          <td>{f.detectado}</td>
                          <td>
                            {f.codigoReal ?? '—'}
                            {f.via === 'fisico' && <span className="mc-via" title="Match por pozo físico (el mensaje no trae la letra de reemplazo)">→ reemplazo</span>}
                            {f.pozoId && pozosPorId.get(f.pozoId)?.reemplazado && (
                              <span className="mc-via" title="Este código está reemplazado en el universo">histórico</span>
                            )}
                          </td>
                          <td>{e.actual ?? '—'}</td>
                          <td><span className={`mc-badge ${f.estatus === 'Abierto' ? 'mc-abierto' : 'mc-cerrado'}`}>{f.estatus}</span></td>
                          <td><span className={`mc-estado ${e.clase}`}>{e.texto}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mc-pie">
                <button type="button" className="mc-boton" onClick={copiarTabla}>
                  {copiado ? 'Copiado ✔' : 'Copiar tabla'}
                </button>
                {okMsg && <span className="mc-ok">{okMsg}</span>}
                {error && <span className="mc-error">{error}</span>}
                <button
                  type="button"
                  className="mc-boton mc-primario"
                  disabled={aplicando || cambios.length === 0}
                  onClick={() => void aplicar()}
                >
                  {aplicando ? 'Aplicando…' : `Aplicar ${cambios.length} cambio(s)`}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
