import { useMemo } from 'react'
import {
  useFiltrosStore,
  pozoPasaFiltros,
  OPCIONES_ESTATUS,
  OPCIONES_METODO,
  OPCIONES_CAMPO,
  FILTROS_DEFAULT,
} from '@/state/filtrosStore'
import { useDatosStore } from '@/state/datosStore'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { diasSinVisitaPorPozo } from '@/domain/visitaCampo'
import {
  NOMBRES_INDICADOR,
  NOMBRES_PERIODO,
  pozosConIndicador,
  type Indicador,
  type PeriodoIndicador,
} from '@/domain/indicadores'
import { formatearFecha } from '@/domain/fecha'
import { TIPOS_INSTALACION_VISIBLES, NOMBRES_TIPO_INSTALACION } from '@/domain/instalacion'
import { COLORES_ESTATUS } from '@/map/capasMarcadores'
import { FiltroMultiSelect } from './FiltroMultiSelect'
import { useArrastrable } from './useArrastrable'
import './PanelFiltros.css'

function Chip({ activo, color, onClick, children }: { activo: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`pf-chip${activo ? ' pf-chip-activo' : ''}`}
      style={activo && color ? { background: color, borderColor: color, color: '#fff' } : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * Sección del modal de filtros — siempre expandida (el modal tiene espacio
 * de sobra en columnas; el colapso solo estorbaba). El `resumen` muestra el
 * estado actual junto al título: "2/3", "Todos", etc.
 */
function Seccion({ titulo, resumen, children }: {
  titulo: string
  resumen?: string
  children: React.ReactNode
}) {
  return (
    <div className="pf-seccion">
      <div className="pf-seccion-titulo">
        {titulo}
        {resumen && <span className="pf-resumen">{resumen}</span>}
      </div>
      <div className="pf-seccion-cuerpo">{children}</div>
    </div>
  )
}

/** Resumen compacto de un multi-select: null = Todos, 0 = Ninguno, n/total. */
function resumenMulti(seleccion: string[] | null, total: number): string {
  if (seleccion === null) return 'Todos'
  if (seleccion.length === 0) return 'Ninguno'
  return `${seleccion.length}/${total}`
}

export function PanelFiltros({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { filtros, setFiltros, alternarEn, limpiar } = useFiltrosStore()
  const { pozos, instalaciones, visitas, indicadores } = useDatosStore()
  const nSeleccion = useAsignacionesStore((s) => s.seleccion.length)
  const limpiarSeleccion = useAsignacionesStore((s) => s.limpiarSeleccion)
  const asignaciones = useAsignacionesStore((s) => s.asignaciones)
  const fechaPlan = useAsignacionesStore((s) => s.fecha)
  // Arrastrable desde el header; la posición persiste entre sesiones.
  const { ref, pos, alArrastrar } = useArrastrable<HTMLElement>('fsp.panelFiltros.pos')

  const instPorId = useMemo(() => new Map(instalaciones.map((i) => [i.id, i])), [instalaciones])

  // Ids "pozo|x" asignados en la fecha del plan actual — para el filtro
  // Asignado/No asignado y para el conteo de "visibles" de abajo.
  const idsAsignadosHoy = useMemo(() => {
    const ids = new Set<string>()
    for (const a of asignaciones) if (a.fecha === fechaPlan) ids.add(a.objetivoId)
    return ids
  }, [asignaciones, fechaPlan])

  // Días desde la última visita por pozo — el mismo mapa que pasa al GeoJSON
  // del mapa; aquí alimenta el predicado JS para el conteo "visibles".
  const diasSinVisita = useMemo(() => diasSinVisitaPorPozo(visitas), [visitas])

  // Pozos con algún indicador elegido dentro del periodo — el mismo set que
  // alimenta la expresión del mapa (filtros.ts).
  const idsIndicador = useMemo(
    () =>
      pozosConIndicador(indicadores, filtros.indicadoresFiltro, filtros.indicadorPeriodo, {
        desde: filtros.indicadorDesde,
      }),
    [indicadores, filtros.indicadoresFiltro, filtros.indicadorPeriodo, filtros.indicadorDesde],
  )

  // Conteo de pozos visibles con la misma lógica que la expresión del mapa,
  // para mostrar "132 de 1398" sin consultar el canvas.
  const visibles = useMemo(() => {
    let n = 0
    for (const p of pozos) {
      if (pozoPasaFiltros(p, filtros, instPorId, idsAsignadosHoy, diasSinVisita, idsIndicador)) n++
    }
    return n
  }, [pozos, filtros, instPorId, idsAsignadosHoy, diasSinVisita, idsIndicador])

  // Códigos EF/MG disponibles, reactivos al Campo activo: si solo BA está
  // marcado, solo aparecen EF/MG de pozos de BA (y viceversa con VLC/VLG).
  // El mapa codigo→campo permite agruparlas visualmente dentro del modal.
  const efInfo = useMemo(() => {
    const campoPorCodigo = new Map<string, string>()
    for (const p of pozos) {
      if (!filtros.campos.includes(p.campo)) continue
      const ef = p.efId && instPorId.get(p.efId)?.codigo
      if (ef && !campoPorCodigo.has(ef)) campoPorCodigo.set(ef, p.campo)
    }
    return campoPorCodigo
  }, [pozos, instPorId, filtros.campos])
  const efCodigos = useMemo(
    () => [...efInfo.keys()].sort((a, b) => a.localeCompare(b)),
    [efInfo],
  )
  const mgInfo = useMemo(() => {
    const campoPorCodigo = new Map<string, string>()
    for (const p of pozos) {
      if (!filtros.campos.includes(p.campo)) continue
      const mg = p.mgId && instPorId.get(p.mgId)?.codigo
      if (mg && !campoPorCodigo.has(mg)) campoPorCodigo.set(mg, p.campo)
    }
    return campoPorCodigo
  }, [pozos, instPorId, filtros.campos])
  const mgCodigos = useMemo(
    () => [...mgInfo.keys()].sort((a, b) => a.localeCompare(b)),
    [mgInfo],
  )

  const total = pozos.filter((p) => p.activo && !p.reemplazado).length
  const tiposPresentes = TIPOS_INSTALACION_VISIBLES.filter((t) => instalaciones.some((i) => i.tipo === t))
  const hayCambios = JSON.stringify(filtros) !== JSON.stringify(FILTROS_DEFAULT)

  if (!abierto) return null

  return (
    <div className="pf-fondo">
    <aside
      ref={ref}
      className="panel-filtros"
      style={pos ? { left: pos.x, top: pos.y, transform: 'none' } : undefined}
    >
      <div className="pf-header pf-header-grip" onPointerDown={alArrastrar} title="Arrastrar para mover">
        <span>Filtros</span>
        <span className="pf-contador">{visibles} / {total} pozos</span>
        <button type="button" className="pf-colapso" onClick={onCerrar} aria-label="Cerrar">×</button>
      </div>

      {filtros.soloIds !== null && (
        <button
          type="button"
          className="pf-deseleccionar"
          title="El mapa está mostrando solo los pozos de la lista pegada — clic para volver a ver todos"
          onClick={() => setFiltros({ soloIds: null })}
        >
          Mostrando solo {filtros.soloIds.length} pozos de la lista ✕
        </button>
      )}

      {nSeleccion > 0 && (
        <button type="button" className="pf-deseleccionar" onClick={limpiarSeleccion}>
          Deseleccionar todo ({nSeleccion})
        </button>
      )}

      <div className="pf-grid">
      <div className="pf-col">
      <Seccion
        titulo="Estatus"
        resumen={`${filtros.estatus.length}/${OPCIONES_ESTATUS.length}`}
      >
        <div className="pf-chips">
          {OPCIONES_ESTATUS.map((e) => (
            <Chip key={e} activo={filtros.estatus.includes(e)} color={COLORES_ESTATUS[e]} onClick={() => alternarEn('estatus', e)}>
              {e}
            </Chip>
          ))}
        </div>
      </Seccion>

      <Seccion
        titulo="Método"
        resumen={filtros.metodos.length === OPCIONES_METODO.length ? 'Todos' : `${filtros.metodos.length}/${OPCIONES_METODO.length}`}
      >
        <div className="pf-chips">
          {OPCIONES_METODO.map((m) => (
            <Chip key={m} activo={filtros.metodos.includes(m)} onClick={() => alternarEn('metodos', m)}>
              {m}
            </Chip>
          ))}
        </div>
      </Seccion>

      <Seccion
        titulo="Campo"
        resumen={filtros.campos.length === OPCIONES_CAMPO.length ? 'Todos' : filtros.campos.join(', ') || 'Ninguno'}
      >
        <div className="pf-chips">
          {OPCIONES_CAMPO.map((c) => (
            <Chip key={c} activo={filtros.campos.includes(c)} onClick={() => alternarEn('campos', c)}>
              {c}
            </Chip>
          ))}
        </div>
      </Seccion>

      </div>

      <div className="pf-col">
      <Seccion
        titulo={`Asignación (${formatearFecha(fechaPlan)})`}
        resumen={{ todos: 'Todos', asignado: 'Asignado', noAsignado: 'No asignado' }[filtros.asignacionFiltro]}
      >
        <div className="pf-estilo-lineas">
          <button
            type="button"
            className={filtros.asignacionFiltro === 'todos' ? 'pf-estilo-activo' : ''}
            onClick={() => setFiltros({ asignacionFiltro: 'todos' })}
          >
            Todos
          </button>
          <button
            type="button"
            className={filtros.asignacionFiltro === 'asignado' ? 'pf-estilo-activo' : ''}
            onClick={() => setFiltros({ asignacionFiltro: 'asignado' })}
          >
            Asignado
          </button>
          <button
            type="button"
            className={filtros.asignacionFiltro === 'noAsignado' ? 'pf-estilo-activo' : ''}
            onClick={() => setFiltros({ asignacionFiltro: 'noAsignado' })}
          >
            No asignado
          </button>
        </div>
      </Seccion>

      <Seccion
        titulo="Límites"
        resumen={
          filtros.diferidoMin === 0 && filtros.bnpdMin === 0 && filtros.sinVisitaDias === 0
            ? 'Sin mínimos'
            : [
                filtros.diferidoMin > 0 && `Dif≥${filtros.diferidoMin}`,
                filtros.bnpdMin > 0 && `BNPD≥${filtros.bnpdMin}`,
                filtros.sinVisitaDias > 0 && `SV≥${filtros.sinVisitaDias}d`,
              ].filter(Boolean).join(' · ')
        }
      >
        <div className="pf-numericos">
          <label>
            Diferido ≥ <input type="number" min={0} value={filtros.diferidoMin || ''} placeholder="0"
              onChange={(e) => setFiltros({ diferidoMin: Number(e.target.value) || 0 })} /> BPD
          </label>
          <label>
            BNPD ≥ <input type="number" min={0} value={filtros.bnpdMin || ''} placeholder="0"
              onChange={(e) => setFiltros({ bnpdMin: Number(e.target.value) || 0 })} /> BPD
          </label>
          <label title="Muestra solo pozos cuya última visita GL/BES fue hace X días o más. Los pozos jamás visitados también pasan.">
            Sin visita ≥ <input type="number" min={0} value={filtros.sinVisitaDias || ''} placeholder="0"
              onChange={(e) => setFiltros({ sinVisitaDias: Number(e.target.value) || 0 })} /> días
          </label>
        </div>
      </Seccion>

      <Seccion
        titulo="Indicadores (historial)"
        resumen={
          filtros.indicadoresFiltro.length === 0
            ? 'Off'
            : `${filtros.indicadorModo === 'incluir' ? 'Incluir' : 'Excluir'} ${filtros.indicadoresFiltro.length} · ${NOMBRES_PERIODO[filtros.indicadorPeriodo]}`
        }
      >
        <div className="pf-chips">
          {(Object.keys(NOMBRES_INDICADOR) as Indicador[]).map((ind) => (
            <Chip
              key={ind}
              activo={filtros.indicadoresFiltro.includes(ind)}
              onClick={() => alternarEn('indicadoresFiltro', ind)}
            >
              {NOMBRES_INDICADOR[ind]}
            </Chip>
          ))}
        </div>
        {filtros.indicadoresFiltro.length > 0 && (
          <>
            <div
              className="pf-estilo-lineas"
              title="Incluir: solo pozos que tienen alguno de estos indicadores. Excluir: todos menos los que los tienen (ej. 'pozos SIN registro manométrico este año')."
            >
              <button
                type="button"
                className={filtros.indicadorModo === 'incluir' ? 'pf-estilo-activo' : ''}
                onClick={() => setFiltros({ indicadorModo: 'incluir' })}
              >
                Incluir
              </button>
              <button
                type="button"
                className={filtros.indicadorModo === 'excluir' ? 'pf-estilo-activo' : ''}
                onClick={() => setFiltros({ indicadorModo: 'excluir' })}
              >
                Excluir
              </button>
            </div>
            <label className="pf-toggle">
              Período:{' '}
              <select
                className="pf-select"
                value={filtros.indicadorPeriodo}
                onChange={(e) => setFiltros({ indicadorPeriodo: e.target.value as PeriodoIndicador })}
              >
                {(Object.keys(NOMBRES_PERIODO) as PeriodoIndicador[]).map((p) => (
                  <option key={p} value={p}>{NOMBRES_PERIODO[p]}</option>
                ))}
              </select>
            </label>
            {filtros.indicadorPeriodo === 'desde' && (
              <label className="pf-toggle" title="El intervalo va desde esta fecha hasta hoy">
                Desde:{' '}
                <input
                  type="date"
                  className="pf-select"
                  value={filtros.indicadorDesde ?? ''}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFiltros({ indicadorDesde: e.target.value || null })}
                />{' '}
                → hoy
              </label>
            )}
          </>
        )}
      </Seccion>

      </div>

      <div className="pf-col">
      <Seccion
        titulo="EF / MG"
        resumen={`EF ${resumenMulti(filtros.efFiltro, efCodigos.length)} · MG ${resumenMulti(filtros.mgFiltro, mgCodigos.length)}`}
      >
        <FiltroMultiSelect
          etiqueta="EF"
          opciones={efCodigos}
          seleccion={filtros.efFiltro}
          onChange={(efFiltro) => setFiltros({ efFiltro })}
          grupoDe={(cod) => efInfo.get(cod)}
        />
        <FiltroMultiSelect
          etiqueta="MG"
          opciones={mgCodigos}
          seleccion={filtros.mgFiltro}
          onChange={(mgFiltro) => setFiltros({ mgFiltro })}
          grupoDe={(cod) => mgInfo.get(cod)}
        />
      </Seccion>

      <Seccion
        titulo="Instalaciones"
        resumen={`${resumenMulti(filtros.tiposInst, tiposPresentes.length)} · líneas ${filtros.mostrarLineas ? 'on' : 'off'}`}
      >
        <FiltroMultiSelect
          etiqueta="Instal."
          opciones={tiposPresentes}
          seleccion={filtros.tiposInst}
          onChange={(tiposInst) => setFiltros({ tiposInst })}
        />
        <div className="pf-leyenda">
          {tiposPresentes.slice(0, 4).map((t) => `${t} ${NOMBRES_TIPO_INSTALACION[t]}`).join(' · ')}
        </div>
        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={filtros.mostrarLineas}
            onChange={(e) => setFiltros({ mostrarLineas: e.target.checked })}
          />
          Líneas pozo↔EF/MG
        </label>
        {filtros.mostrarLineas && (
          <div className="pf-estilo-lineas" title="Cómo indicar el sentido instalación→pozo, para comparar">
            <button
              type="button"
              className={filtros.estiloLineas === 'gradiente' ? 'pf-estilo-activo' : ''}
              onClick={() => setFiltros({ estiloLineas: 'gradiente' })}
            >
              Gradiente
            </button>
            <button
              type="button"
              className={filtros.estiloLineas === 'animado' ? 'pf-estilo-activo' : ''}
              onClick={() => setFiltros({ estiloLineas: 'animado' })}
            >
              Animado
            </button>
          </div>
        )}
        <label
          className="pf-toggle"
          title="Marcado: solo se ven instalaciones EF/MG asociadas a los pozos que pasan los filtros actuales (ej. solo Cerrados → solo sus EF/MG). Desmarcado: todas las instalaciones."
        >
          <input
            type="checkbox"
            checked={filtros.soloInstAsociadas}
            onChange={(e) => setFiltros({ soloInstAsociadas: e.target.checked })}
          />
          Solo inst. de pozos visibles
        </label>
      </Seccion>
      </div>
      </div>

      {hayCambios && (
        <button type="button" className="pf-limpiar" onClick={limpiar}>Limpiar filtros</button>
      )}
    </aside>
    </div>
  )
}
