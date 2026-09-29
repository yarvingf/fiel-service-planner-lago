import { useMemo, useState } from 'react'
import { useDatosStore } from '@/state/datosStore'
import { calcularDerivadosPozo, type PozoConCompletaciones } from '@/domain/pozo'
import { NOMBRES_TIPO_INSTALACION, type Instalacion } from '@/domain/instalacion'
import { ultimaVisitaPorPozo, type VisitaCampo } from '@/domain/visitaCampo'
import { listarVisitasPozo } from '@/data/persistencia'
import { supabase } from '@/data/supabaseClient'
import { COLORES_ESTATUS } from '@/map/capasMarcadores'
import './PanelDetalle.css'

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('es-VE', { maximumFractionDigits: 1 })
}

function fmtFecha(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString('es-VE') : '—'
}

/** Resumen compacto de la última visita GL/BES del pozo (bitácora, no estado). */
function UltimaVisita({ visita }: { visita: VisitaCampo }) {
  return (
    <>
      <div className="pd-subtitulo">Última visita ({visita.tipo})</div>
      <div className="pd-grid">
        <span>Fecha</span><b>{fmtFecha(visita.fecha)}</b>
        <span>Cuadrilla</span><b>{visita.cuadrilla || '—'}</b>
        <span>Actividad</span><b>{visita.tipoActividad ?? '—'}</b>
        <span>Estado inicial</span><b>{visita.estadoInicial ?? '—'}</b>
        <span>Estado final</span><b>{visita.estadoFinal ?? '—'}</b>
      </div>
      {visita.comentarios && <div className="pd-comentario">{visita.comentarios}</div>}
    </>
  )
}

/**
 * Historial completo de visitas del pozo — NO se carga al arranque (el
 * universo solo trae la última por pozo); se pide a Supabase al expandir.
 * En dev sin Supabase filtra las visitas ya en memoria (cargarExcelDev las
 * conserva completas).
 */
function HistorialVisitas({ pozoId }: { pozoId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [lista, setLista] = useState<VisitaCampo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = async () => {
    setAbierto((v) => !v)
    if (lista !== null || abierto) return
    try {
      if (supabase) {
        setLista(await listarVisitasPozo(pozoId))
      } else {
        setLista(
          useDatosStore.getState().visitas
            .filter((v) => v.pozoId === pozoId)
            .sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <button type="button" className="pd-historial-toggle" onClick={() => void cargar()}>
        {abierto ? '▾' : '▸'} Historial de visitas{lista ? ` (${lista.length})` : ''}
      </button>
      {abierto && (
        <div className="pd-historial">
          {error && <div className="pd-aviso">⚠ {error}</div>}
          {!error && lista === null && <span className="pd-vacio">Cargando…</span>}
          {lista?.length === 0 && <span className="pd-vacio">Sin visitas registradas</span>}
          {lista?.map((v) => (
            <div key={v.id} className="pd-visita">
              <b>{fmtFecha(v.fecha)}</b> · {v.tipo} · {v.cuadrilla || '—'}
              {v.tipoActividad && <> · {v.tipoActividad}</>}
              {v.estadoFinal && <> · <b>{v.estadoFinal}</b></>}
              {v.comentarios && <div className="pd-comentario">{v.comentarios}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function DetallePozo({ pozo }: { pozo: PozoConCompletaciones }) {
  const instalaciones = useDatosStore((s) => s.instalaciones)
  const visitas = useDatosStore((s) => s.visitas)
  const instPorId = new Map(instalaciones.map((i) => [i.id, i]))
  const d = calcularDerivadosPozo(pozo.completaciones)
  const ef = pozo.efId ? instPorId.get(pozo.efId)?.codigo ?? '—' : '—'
  const mg = pozo.mgId ? instPorId.get(pozo.mgId)?.codigo ?? '—' : '—'
  // El mapa completo se recalcula solo si cambia `visitas` (tras un sync),
  // no en cada clic de selección de pozo — evita reconstruirlo por cada click.
  const mapaUltimaVisita = useMemo(() => ultimaVisitaPorPozo(visitas), [visitas])
  const ultimaVisita = mapaUltimaVisita.get(pozo.id) ?? null

  return (
    <>
      <div className="pd-titulo">
        {pozo.codigo}
        <span className="pd-badge" style={{ background: COLORES_ESTATUS[d.estatus] }}>{d.estatus}</span>
        {pozo.reemplazo && <span className="pd-reemplazo">reemplazo {pozo.reemplazo}</span>}
      </div>

      <div className="pd-grid">
        <span>Campo</span><b>{pozo.campo}</b>
        <span>Método(s)</span><b>{d.metodos.join(', ') || '—'}</b>
        <span>CAT</span><b>{d.categorias.join(', ') || '—'}</b>
        <span>EF</span><b>{ef}</b>
        <span>MG</span><b>{mg}</b>
        <span>BNPD activo</span><b>{fmtNum(d.bnpdActivo)}</b>
        <span>Diferido confirmado</span><b>{fmtNum(d.potencialDiferidoConfirmado)}</b>
        <span>Diferido posible</span><b>{fmtNum(d.potencialDiferidoPosible)}</b>
        {d.diferidoIncompleto && <span className="pd-aviso">⚠ diferido incompleto (POT sin reportar)</span>}
        <span>Coordenadas</span><b>{pozo.lat?.toFixed(5)}, {pozo.lon?.toFixed(5)}</b>
      </div>

      <div className="pd-subtitulo">Arenas ({pozo.completaciones.length})</div>
      <table className="pd-tabla">
        <thead>
          <tr><th>Yacimiento</th><th>COA</th><th>Mét.</th><th>CAT</th><th>POT</th><th>BNPD</th><th>Fecha</th><th>EDO</th></tr>
        </thead>
        <tbody>
          {pozo.completaciones.map((c) => (
            <tr key={c.id}>
              <td className="pd-yac">{c.nbYacimiento || '—'}</td>
              <td><span className="pd-coa" style={{ background: COLORES_ESTATUS[c.coa] }}>{c.coa}</span></td>
              <td>{c.metodo ?? '—'}</td>
              <td>{fmtNum(c.cat)}</td>
              <td>{fmtNum(c.pot)}</td>
              <td>{fmtNum(c.bnpd)}</td>
              <td>{fmtFecha(c.bnpdFecha)}</td>
              <td>{c.edo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {ultimaVisita ? <UltimaVisita visita={ultimaVisita} /> : (
        <>
          <div className="pd-subtitulo">Última visita</div>
          <span className="pd-vacio">Sin visitas GL/BES vinculadas a este pozo</span>
        </>
      )}
      <HistorialVisitas pozoId={pozo.id} />
    </>
  )
}

function DetalleInstalacion({ inst }: { inst: Instalacion }) {
  const pozos = useDatosStore((s) => s.pozos)
  const asociados = pozos.filter((p) => !p.reemplazado && (p.efId === inst.id || p.mgId === inst.id))

  return (
    <>
      <div className="pd-titulo">
        {inst.codigo}
        <span className="pd-badge pd-badge-inst">{inst.tipo}</span>
      </div>
      <div className="pd-grid">
        <span>Tipo</span><b>{NOMBRES_TIPO_INSTALACION[inst.tipo] ?? inst.tipo}</b>
        <span>Campo</span><b>{inst.campo}</b>
        <span>Coordenadas</span><b>{inst.lat?.toFixed(5) ?? '—'}, {inst.lon?.toFixed(5) ?? '—'}</b>
        {inst.esStub && <span className="pd-aviso">⚠ stub (sin coordenadas en el catálogo)</span>}
      </div>
      <div className="pd-subtitulo">Pozos asociados ({asociados.length})</div>
      <div className="pd-lista">
        {asociados.slice(0, 30).map((p) => <span key={p.id} className="pd-chip">{p.codigo}</span>)}
        {asociados.length > 30 && <span className="pd-chip">+{asociados.length - 30} más</span>}
        {asociados.length === 0 && <span className="pd-vacio">Ninguno</span>}
      </div>
    </>
  )
}

export function PanelDetalle() {
  const { seleccionado, pozos, instalaciones, seleccionar } = useDatosStore()
  if (!seleccionado) return null

  const pozo = seleccionado.kind === 'pozo' ? pozos.find((p) => p.id === seleccionado.id) : undefined
  const inst = seleccionado.kind === 'instalacion' ? instalaciones.find((i) => i.id === seleccionado.id) : undefined
  if (!pozo && !inst) return null

  return (
    <aside className="panel-detalle">
      <button type="button" className="pd-cerrar" onClick={() => seleccionar(null)} aria-label="Cerrar">×</button>
      {pozo && <DetallePozo pozo={pozo} />}
      {inst && <DetalleInstalacion inst={inst} />}
    </aside>
  )
}
