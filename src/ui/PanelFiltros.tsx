import { useMemo, useState } from 'react'
import {
  useFiltrosStore,
  OPCIONES_ESTATUS,
  OPCIONES_METODO,
  OPCIONES_CAMPO,
  FILTROS_DEFAULT,
} from '@/state/filtrosStore'
import { useDatosStore } from '@/state/datosStore'
import { useAsignacionesStore } from '@/state/asignacionesStore'
import { calcularDerivadosPozo } from '@/domain/pozo'
import { formatearFecha } from '@/domain/fecha'
import { TIPOS_INSTALACION_VISIBLES, NOMBRES_TIPO_INSTALACION } from '@/domain/instalacion'
import { COLORES_ESTATUS } from '@/map/capasMarcadores'
import { FiltroMultiSelect } from './FiltroMultiSelect'
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

export function PanelFiltros() {
  const { filtros, setFiltros, alternarEn, limpiar } = useFiltrosStore()
  const { pozos, instalaciones } = useDatosStore()
  const nSeleccion = useAsignacionesStore((s) => s.seleccion.length)
  const limpiarSeleccion = useAsignacionesStore((s) => s.limpiarSeleccion)
  const asignaciones = useAsignacionesStore((s) => s.asignaciones)
  const fechaPlan = useAsignacionesStore((s) => s.fecha)
  const [colapsado, setColapsado] = useState(false)

  const instPorId = useMemo(() => new Map(instalaciones.map((i) => [i.id, i])), [instalaciones])

  // Ids "pozo|x" asignados en la fecha del plan actual — para el filtro
  // Asignado/No asignado y para el conteo de "visibles" de abajo.
  const idsAsignadosHoy = useMemo(() => {
    const ids = new Set<string>()
    for (const a of asignaciones) if (a.fecha === fechaPlan) ids.add(a.objetivoId)
    return ids
  }, [asignaciones, fechaPlan])

  // Conteo de pozos visibles con la misma lógica que la expresión del mapa,
  // para mostrar "132 de 1398" sin consultar el canvas.
  const visibles = useMemo(() => {
    let n = 0
    for (const p of pozos) {
      if (p.reemplazado || !p.activo || p.lat === null) continue
      const d = calcularDerivadosPozo(p.completaciones)
      if (!filtros.estatus.includes(d.estatus)) continue
      if (!filtros.campos.includes(p.campo)) continue
      if (!d.metodos.some((m) => filtros.metodos.includes(m))) continue
      if (d.potencialDiferidoConfirmado < filtros.diferidoMin) continue
      if (d.bnpdActivo < filtros.bnpdMin) continue
      const ef = (p.efId && instPorId.get(p.efId)?.codigo) ?? ''
      const mg = (p.mgId && instPorId.get(p.mgId)?.codigo) ?? ''
      if (filtros.efFiltro !== null && !filtros.efFiltro.includes(ef)) continue
      if (filtros.mgFiltro !== null && !filtros.mgFiltro.includes(mg)) continue
      if (filtros.asignacionFiltro !== 'todos') {
        const asignado = idsAsignadosHoy.has(`pozo|${p.id}`)
        if (filtros.asignacionFiltro === 'asignado' && !asignado) continue
        if (filtros.asignacionFiltro === 'noAsignado' && asignado) continue
      }
      n++
    }
    return n
  }, [pozos, filtros, instPorId, idsAsignadosHoy])

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

  return (
    <aside className={`panel-filtros${colapsado ? ' pf-colapsado' : ''}`}>
      <div className="pf-header">
        <button
          type="button"
          className="pf-colapso"
          title={colapsado ? 'Expandir filtros' : 'Colapsar filtros'}
          onClick={() => setColapsado((v) => !v)}
        >
          {colapsado ? '▸' : '▾'}
        </button>
        <span>Filtros</span>
        {!colapsado && <span className="pf-contador">{visibles} / {total} pozos</span>}
      </div>

      {!colapsado && nSeleccion > 0 && (
        <button type="button" className="pf-deseleccionar" onClick={limpiarSeleccion}>
          Deseleccionar todo ({nSeleccion})
        </button>
      )}

      {!colapsado && <>
      <div className="pf-seccion">
        <div className="pf-etiqueta">Estatus</div>
        <div className="pf-chips">
          {OPCIONES_ESTATUS.map((e) => (
            <Chip key={e} activo={filtros.estatus.includes(e)} color={COLORES_ESTATUS[e]} onClick={() => alternarEn('estatus', e)}>
              {e}
            </Chip>
          ))}
        </div>
      </div>

      <div className="pf-seccion">
        <div className="pf-etiqueta">Método</div>
        <div className="pf-chips">
          {OPCIONES_METODO.map((m) => (
            <Chip key={m} activo={filtros.metodos.includes(m)} onClick={() => alternarEn('metodos', m)}>
              {m}
            </Chip>
          ))}
        </div>
      </div>

      <div className="pf-seccion">
        <div className="pf-etiqueta">Campo</div>
        <div className="pf-chips">
          {OPCIONES_CAMPO.map((c) => (
            <Chip key={c} activo={filtros.campos.includes(c)} onClick={() => alternarEn('campos', c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      <div className="pf-seccion">
        <div className="pf-etiqueta">Asignación ({formatearFecha(fechaPlan)})</div>
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
      </div>

      <div className="pf-seccion pf-numericos">
        <label>
          Diferido ≥ <input type="number" min={0} value={filtros.diferidoMin || ''} placeholder="0"
            onChange={(e) => setFiltros({ diferidoMin: Number(e.target.value) || 0 })} /> BPD
        </label>
        <label>
          BNPD ≥ <input type="number" min={0} value={filtros.bnpdMin || ''} placeholder="0"
            onChange={(e) => setFiltros({ bnpdMin: Number(e.target.value) || 0 })} /> BPD
        </label>
      </div>

      <div className="pf-seccion">
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
      </div>

      <div className="pf-seccion">
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
      </div>

      {hayCambios && (
        <button type="button" className="pf-limpiar" onClick={limpiar}>Limpiar filtros</button>
      )}
      </>}
    </aside>
  )
}
