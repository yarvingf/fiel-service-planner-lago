import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import './FiltroMultiSelect.css'

interface Props {
  etiqueta: string
  /** Opciones disponibles, ya ordenadas alfabéticamente por el llamador. */
  opciones: string[]
  /** null = todas (sin filtrar). */
  seleccion: string[] | null
  onChange: (nuevo: string[] | null) => void
  /**
   * Si se pasa, agrupa las opciones bajo encabezados (p. ej. campo BA/VLC/VLG).
   * '' o undefined cae en el grupo "Otros", que va al final.
   */
  grupoDe?: (opcion: string) => string | undefined
}

/**
 * Selector tipo Excel, en modal: más cómodo que un dropdown angosto cuando
 * hay muchas opciones (EF/MG/tipos de instalación pueden ser decenas). Misma
 * lógica de selección que antes (null = todas, [] = ninguna), solo cambia
 * la presentación — de popover flotante a modal centrado con grid.
 */
export function FiltroMultiSelect({ etiqueta, opciones, seleccion, onChange, grupoDe }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  /** Grupos expandidos; vacío = todos plegados al abrir el modal. */
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const todas = seleccion === null
  const marcadas = seleccion?.length ?? opciones.length
  const resumen = todas ? 'Todos' : marcadas === 0 ? 'Ninguno' : `${marcadas}/${opciones.length}`

  const q = busqueda.trim().toLowerCase()
  const visibles = q ? opciones.filter((op) => op.toLowerCase().includes(q)) : opciones

  // Agrupación opcional (p. ej. por campo). Las opciones ya vienen ordenadas
  // alfabéticamente; el grupo "Otros" (sin grupo asignado) va siempre al final.
  const grupos = useMemo(() => {
    if (!grupoDe) return null
    const m = new Map<string, string[]>()
    for (const op of visibles) {
      const g = grupoDe(op) || 'Otros'
      const arr = m.get(g)
      if (arr) arr.push(op)
      else m.set(g, [op])
    }
    return [...m.entries()].sort(([a], [b]) =>
      a === 'Otros' ? 1 : b === 'Otros' ? -1 : a.localeCompare(b),
    )
  }, [visibles, grupoDe])

  const abrir = () => {
    setBusqueda('')
    setExpandidos(new Set())
    setAbierto(true)
  }

  const alternarGrupo = (grupo: string) =>
    setExpandidos((prev) => {
      const nuevo = new Set(prev)
      if (nuevo.has(grupo)) nuevo.delete(grupo)
      else nuevo.add(grupo)
      return nuevo
    })

  const alternar = (op: string) => {
    const actual = seleccion ?? opciones
    const nuevo = actual.includes(op) ? actual.filter((x) => x !== op) : [...actual, op]
    onChange(nuevo.length === opciones.length ? null : nuevo)
  }

  // Con búsqueda activa, "(Todos)" solo afecta lo visible (filtrado) — igual
  // que el filtro de Excel: no se pierde la selección de lo que no se ve.
  const visiblesMarcadas = visibles.filter((op) => todas || seleccion!.includes(op))
  const todoVisibleMarcado = visibles.length > 0 && visiblesMarcadas.length === visibles.length

  const alternarTodoVisible = (marcar: boolean) => {
    if (!q) {
      onChange(marcar ? null : [])
      return
    }
    const actual = seleccion ?? opciones
    const nuevo = marcar
      ? [...new Set([...actual, ...visibles])]
      : actual.filter((op) => !visibles.includes(op))
    onChange(nuevo.length === opciones.length ? null : nuevo)
  }

  return (
    <div className="fms">
      <label className="fms-etiqueta">{etiqueta}</label>
      <button type="button" className="fms-boton" onClick={abrir}>
        {resumen} ▾
      </button>
      {abierto && createPortal(
        <div className="fms-fondo" onClick={() => setAbierto(false)}>
          <div className="fms-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fms-modal-titulo">
              {etiqueta}
              <span className="fms-modal-resumen">{resumen}</span>
              <button type="button" className="fms-cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar">×</button>
            </div>

            {opciones.length > 6 && (
              <input
                type="text"
                className="fms-buscar"
                placeholder="Buscar..."
                value={busqueda}
                autoFocus
                onChange={(e) => setBusqueda(e.target.value)}
              />
            )}

            <label className="fms-item fms-item-principal">
              <input
                type="checkbox"
                checked={q ? todoVisibleMarcado : todas}
                onChange={(e) => alternarTodoVisible(e.target.checked)}
              />
              {q ? '(Todos los visibles)' : '(Todos)'}
            </label>

            <div className="fms-lista">
              {opciones.length === 0 && <div className="fms-vacio">Sin datos cargados</div>}
              {opciones.length > 0 && visibles.length === 0 && <div className="fms-vacio">Sin coincidencias</div>}
              {grupos
                ? grupos.map(([grupo, ops]) => {
                    const marcadasGrupo = ops.filter((op) => todas || seleccion!.includes(op)).length
                    // Con búsqueda activa los grupos se abren solos para no
                    // esconder coincidencias dentro de un grupo plegado.
                    const expandido = q.length > 0 || expandidos.has(grupo)
                    return (
                      <div key={grupo} className="fms-grupo">
                        <button
                          type="button"
                          className="fms-grupo-titulo"
                          onClick={() => alternarGrupo(grupo)}
                        >
                          <span className="fms-grupo-flecha">{expandido ? '▾' : '▸'}</span>
                          {grupo}
                          <span className="fms-grupo-n">
                            {marcadasGrupo < ops.length ? `${marcadasGrupo}/` : ''}{ops.length}
                          </span>
                        </button>
                        {expandido && (
                          <div className="fms-grupo-items">
                            {ops.map((op) => (
                              <label key={op} className="fms-item">
                                <input
                                  type="checkbox"
                                  checked={todas || seleccion!.includes(op)}
                                  onChange={() => alternar(op)}
                                />
                                {op}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                : visibles.map((op) => (
                    <label key={op} className="fms-item">
                      <input
                        type="checkbox"
                        checked={todas || seleccion!.includes(op)}
                        onChange={() => alternar(op)}
                      />
                      {op}
                    </label>
                  ))}
            </div>

            <div className="fms-modal-pie">
              <button type="button" className="fms-listo" onClick={() => setAbierto(false)}>Listo</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
