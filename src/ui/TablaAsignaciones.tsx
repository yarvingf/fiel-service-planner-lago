import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClassParams,
  type CellClickedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type IRowNode,
  type SelectionChangedEvent,
  type ValueGetterParams,
} from 'ag-grid-community'
import type { AsignacionRec, IdObjetivo } from '@/state/asignacionesStore'
import type { DetalleObjetivo } from '@/domain/detalleAsignacion'
import type { CamposAsignacion } from '@/data/persistencia'
import {
  COPIA_PEGADO as COPIA,
  PARSEO_PEGADO as PARSEO,
  type CampoChecklist,
} from '@/data/portapapelesAsignaciones'

ModuleRegistry.registerModules([AllCommunityModule])

/**
 * Fila de la grilla: la asignación "vista" (con ediciones pendientes ya
 * mezcladas) + el detalle del pozo + qué campos tienen cambios sin aplicar.
 */
export interface FilaGrid extends AsignacionRec {
  _d?: DetalleObjetivo
  _pend?: CamposAsignacion
}

/** Contexto compartido con los cellRenderers (params.context). */
interface Ctx {
  deshabilitado: boolean
  onEditar: (id: string, campos: CamposAsignacion) => void
  onIrA: (objetivoId: IdObjetivo) => void
  onCopiarGrupo: (fila: FilaGrid) => void
  onDesasignar: (fila: FilaGrid) => void
}

const TITULO_TOGGLE: Record<CampoChecklist, string> = {
  validarAjuste: 'Validar ajuste',
  requiereManometro: 'Requiere manómetro',
  requiereNivel: 'Requiere nivel',
}

/** Celda SI/NO del checklist: alterna local (ámbar = pendiente de Aplicar). */
function CeldaToggle(campo: CampoChecklist) {
  return function Render(p: ICellRendererParams<FilaGrid>) {
    const ctx = p.context as Ctx
    if (!p.data) return null
    const valor = Boolean(p.data[campo])
    const pend = p.data._pend?.[campo] !== undefined
    return (
      <button
        type="button"
        className={`ma-toggle ${valor ? 'ma-toggle-si' : 'ma-toggle-no'}${pend ? ' ma-pendiente' : ''}`}
        title={`${TITULO_TOGGLE[campo]}: ${valor ? 'SI' : 'NO'} — clic para cambiar (se guarda con Aplicar)`}
        disabled={ctx.deshabilitado}
        onClick={() => ctx.onEditar(p.data!.id, { [campo]: !valor })}
      >
        {valor ? 'SI' : 'NO'}
      </button>
    )
  }
}

/** Código del pozo como botón: clic → vuela el mapa hasta el objetivo. */
function CeldaCodigo(p: ICellRendererParams<FilaGrid>) {
  const ctx = p.context as Ctx
  if (!p.data) return null
  return (
    <button
      type="button"
      className="ma-codigo"
      title={`Ir a ${p.value} en el mapa`}
      onClick={() => ctx.onIrA(p.data!.objetivoId)}
    >
      {p.value}
    </button>
  )
}

/** Última columna: copiar a la cuadrilla + desasignar. */
function CeldaAcciones(p: ICellRendererParams<FilaGrid>) {
  const ctx = p.context as Ctx
  if (!p.data) return null
  return (
    <span className="ma-acciones">
      <button
        type="button"
        className="ma-copiar"
        title="Copiar actividad+nota+prioridad a todos los objetivos de esta cuadrilla"
        disabled={ctx.deshabilitado}
        onClick={() => ctx.onCopiarGrupo(p.data!)}
      >
        ⧉
      </button>
      <button
        type="button"
        className="ma-quitar"
        title="Desasignar"
        disabled={ctx.deshabilitado}
        onClick={() => ctx.onDesasignar(p.data!)}
      >
        ×
      </button>
    </span>
  )
}

/** Columnas que no son "datos": no entran al rango Shift+flechas ni a copiar. */
const COLS_NO_DATOS = new Set(['acciones', 'ag-Grid-SelectionColumn'])

const detalle =
  (campo: 'ef' | 'mg' | 'pot' | 'bnpd' | 'metodos') =>
  (p: ValueGetterParams<FilaGrid>) => {
    const d = p.data?._d
    if (!d) return null
    const v = d[campo]
    return Array.isArray(v) ? v.join(' ') : v
  }

const tema = themeQuartz.withParams({
  fontSize: 12,
  headerFontSize: 10,
  headerFontWeight: 700,
  headerHeight: 30,
  rowHeight: 30,
  headerTextColor: '#64748b',
  borderColor: '#f1f5f9',
  headerBackgroundColor: '#ffffff',
  // Sin pintado de fila seleccionada: la selección se discierne por el
  // checkbox y por el rango de celdas azulito (estilo Excel, no fila entera).
  selectedRowBackgroundColor: 'transparent',
})

interface Props {
  /** Filas del grupo (vista con pendientes aplicados). */
  items: AsignacionRec[]
  detalleDe: ReadonlyMap<string, DetalleObjetivo>
  pendientes: ReadonlyMap<string, CamposAsignacion>
  deshabilitado: boolean
  /** Registra el GridApi del grupo para poder deseleccionar desde afuera. */
  onGridReady: (api: GridApi<FilaGrid>) => void
  onSeleccion: (ids: string[]) => void
  onEditar: (id: string, campos: CamposAsignacion) => void
  onIrA: (objetivoId: IdObjetivo) => void
  onCopiarGrupo: (fila: FilaGrid) => void
  onDesasignar: (fila: FilaGrid) => void
}

/**
 * Grilla tipo Excel de las asignaciones de una cuadrilla: edición en celda,
 * orden multi-columna con Ctrl+clic (nativo), checkbox de selección en cada
 * fila y en el encabezado ("marcar todo el grupo"). Los cambios no viajan
 * solos: se acumulan vía onEditar hasta que el usuario pulsa "Aplicar".
 */
export function TablaAsignaciones({
  items,
  detalleDe,
  pendientes,
  deshabilitado,
  onGridReady,
  onSeleccion,
  onEditar,
  onIrA,
  onCopiarGrupo,
  onDesasignar,
}: Props) {
  const rows = useMemo<FilaGrid[]>(
    () =>
      items.map((a) => ({
        ...a,
        _d: detalleDe.get(a.objetivoId),
        _pend: pendientes.get(a.id),
      })),
    [items, detalleDe, pendientes],
  )

  const context = useMemo<Ctx>(
    () => ({ deshabilitado, onEditar, onIrA, onCopiarGrupo, onDesasignar }),
    [deshabilitado, onEditar, onIrA, onCopiarGrupo, onDesasignar],
  )

  const apiRef = useRef<GridApi<FilaGrid> | null>(null)
  // Al desmontar (grupo plegado), reporta selección vacía: si no, el set
  // global del modal conservaría ids de una grilla ya destruida.
  const onSeleccionRef = useRef(onSeleccion)
  useEffect(() => {
    onSeleccionRef.current = onSeleccion
  })
  useEffect(() => () => onSeleccionRef.current([]), [])
  /** Celdas copiadas (borde punteado estilo "marching ants" de Excel). */
  const copiadoRef = useRef<{ colId: string; ids: Set<string> } | null>(null)
  /** Rango de celdas seleccionado con Shift+flechas (a = ancla, b = foco). */
  const rangoRef = useRef<{ a: { f: number; c: string }; b: { f: number; c: string } } | null>(null)
  /** Ids que el gesto de rango marcó (para contraer/deseleccionar solo esos). */
  const rangoIdsRef = useRef<Set<string>>(new Set())
  const enGestoRango = useRef(false)
  const gestoSeqRef = useRef(0)
  /** selectionChanged puede dispararse en un tick posterior al setSelected:
   *  la bandera se suelta en el siguiente tick para que el handler la vea. */
  const soltarGesto = () => {
    const seq = ++gestoSeqRef.current
    setTimeout(() => {
      if (gestoSeqRef.current === seq) enGestoRango.current = false
    }, 0)
  }

  const enRango = useCallback((p: CellClassParams<FilaGrid>): boolean => {
    const r = rangoRef.current
    const api = apiRef.current
    const f = p.node.rowIndex
    if (!r || !api || f == null) return false
    const cols = api.getAllDisplayedColumns()
    const iA = cols.findIndex((c) => c.getColId() === r.a.c)
    const iB = cols.findIndex((c) => c.getColId() === r.b.c)
    const iC = cols.findIndex((c) => c.getColId() === p.column.getColId())
    if (iA < 0 || iB < 0 || iC < 0) return false
    const [fA, fB] = r.a.f <= r.b.f ? [r.a.f, r.b.f] : [r.b.f, r.a.f]
    const [cA, cB] = iA <= iB ? [iA, iB] : [iB, iA]
    return f >= fA && f <= fB && iC >= cA && iC <= cB
  }, [])

  /** Clases Excel-like: ámbar si el campo está pendiente, punteado si la celda
   *  está copiada, azulito si cae dentro del rango Shift+flechas. */
  const clasesCelda = useCallback(
    (campo?: keyof CamposAsignacion) =>
      (p: CellClassParams<FilaGrid>): string[] => {
        const out: string[] = []
        if (campo && p.data?._pend?.[campo] !== undefined) out.push('ma-cell-pendiente')
        const cop = copiadoRef.current
        if (cop && p.data && cop.ids.has(p.data.id) && p.column.getColId() === cop.colId)
          out.push('ma-cell-copiada')
        // Azulito en el rango Shift+flechas O en las celdas de datos de una
        // fila seleccionada (checkbox y acciones quedan sin pintar).
        if (enRango(p) || (p.node.isSelected() && !COLS_NO_DATOS.has(p.column.getColId())))
          out.push('ma-cell-rango')
        return out
      },
    [enRango],
  )

  const columnas = useMemo<ColDef<FilaGrid>[]>(
    () => [
      { headerName: 'Código', colId: 'codigo', field: 'codigo', width: 140, cellRenderer: CeldaCodigo, cellClass: clasesCelda() },
      { headerName: 'EF', colId: 'ef', width: 72, valueGetter: detalle('ef'), cellClass: clasesCelda() },
      { headerName: 'MG', colId: 'mg', width: 72, valueGetter: detalle('mg'), cellClass: clasesCelda() },
      { headerName: 'POT', colId: 'pot', width: 62, valueGetter: detalle('pot'), cellStyle: { textAlign: 'right' }, cellClass: clasesCelda() },
      { headerName: 'BNPD', colId: 'bnpd', width: 62, valueGetter: detalle('bnpd'), cellStyle: { textAlign: 'right' }, cellClass: clasesCelda() },
      { headerName: 'Metodo', colId: 'metodo', width: 72, valueGetter: detalle('metodos'), editable: false, cellClass: clasesCelda() },
      {
        headerName: 'Actividad',
        colId: 'actividad',
        field: 'actividad',
        editable: true,
        width: 170,
        cellClass: clasesCelda('actividad'),
      },
      {
        headerName: 'Prior.',
        colId: 'prioridad',
        field: 'prioridad',
        editable: true,
        width: 62,
        cellStyle: { textAlign: 'right' },
        cellClass: clasesCelda('prioridad'),
        valueParser: (p) => {
          const t = String(p.newValue ?? '').trim()
          const n = Number(t)
          return t === '' || !Number.isFinite(n) ? null : Math.trunc(n)
        },
      },
      {
        headerName: 'Ajuste',
        colId: 'validarAjuste',
        width: 56,
        cellRenderer: CeldaToggle('validarAjuste'),
        valueGetter: (p) => (p.data?.validarAjuste ? 1 : 0),
        cellClass: clasesCelda('validarAjuste'),
      },
      {
        headerName: 'Manóm.',
        colId: 'requiereManometro',
        width: 62,
        cellRenderer: CeldaToggle('requiereManometro'),
        valueGetter: (p) => (p.data?.requiereManometro ? 1 : 0),
        cellClass: clasesCelda('requiereManometro'),
      },
      {
        headerName: 'Nivel',
        colId: 'requiereNivel',
        width: 52,
        cellRenderer: CeldaToggle('requiereNivel'),
        valueGetter: (p) => (p.data?.requiereNivel ? 1 : 0),
        cellClass: clasesCelda('requiereNivel'),
      },
      { headerName: 'Nota', colId: 'nota', field: 'nota', editable: true, flex: 1, minWidth: 120, cellClass: clasesCelda('nota') },
      {
        colId: 'acciones',
        width: 60,
        sortable: false,
        resizable: false,
        suppressMovable: true,
        editable: false,
        cellRenderer: CeldaAcciones,
      },
    ],
    [clasesCelda],
  )

  const alCambiarCelda = (e: CellValueChangedEvent<FilaGrid>) => {
    const campo = e.colDef.field
    if (!e.data) return
    if (campo === 'actividad' || campo === 'nota') {
      const v = typeof e.newValue === 'string' ? e.newValue.trim() : ''
      onEditar(e.data.id, { [campo]: v || null })
    } else if (campo === 'prioridad') {
      onEditar(e.data.id, { prioridad: e.newValue ?? null })
    }
  }

  /** Quita el rango azulito (y desmarca solo lo que el gesto había marcado). */
  const limpiarRango = (api: GridApi<FilaGrid>, desmarcar: boolean) => {
    if (desmarcar && rangoIdsRef.current.size > 0) {
      enGestoRango.current = true
      try {
        for (const id of rangoIdsRef.current) api.getRowNode(id)?.setSelected(false)
      } finally {
        soltarGesto()
      }
    }
    rangoIdsRef.current = new Set()
    if (rangoRef.current) {
      rangoRef.current = null
      api.refreshCells({ force: true })
    }
  }

  const alSeleccionar = (e: SelectionChangedEvent<FilaGrid>) => {
    if (!enGestoRango.current) limpiarRango(e.api, false)
    // Repinta: las filas seleccionadas pasan por cellClass para su azulito.
    e.api.refreshCells({ force: true })
    onSeleccion(e.api.getSelectedRows().map((r) => r.id))
  }

  /** Ctrl+C: celda enfocada, o esa columna de todas las filas marcadas.
   *  Las celdas copiadas quedan marcadas con borde punteado hasta pegar/Esc. */
  const copiar = (api: GridApi<FilaGrid>) => {
    const foco = api.getFocusedCell()
    let colId = foco ? foco.column.getColId() : 'codigo'
    if (COLS_NO_DATOS.has(colId)) colId = 'codigo'
    const sel = api.getSelectedNodes()
    const nodos =
      sel.length > 0
        ? [...sel].sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0))
        : foco
          ? [api.getDisplayedRowAtIndex(foco.rowIndex)].filter((n): n is IRowNode<FilaGrid> => Boolean(n))
          : []
    if (nodos.length === 0) return
    const fmt = COPIA[colId] ?? ((v: unknown) => (v == null ? '' : String(v)))
    void navigator.clipboard.writeText(
      nodos.map((n) => fmt(api.getCellValue({ rowNode: n, colKey: colId }))).join('\n'),
    )
    copiadoRef.current = { colId, ids: new Set(nodos.map((n) => n.data?.id ?? '').filter(Boolean)) }
    api.refreshCells({ force: true })
  }

  /**
   * Ctrl+V (tipo Excel): con filas marcadas → reparte las líneas entre ellas
   * (1 valor = todas; se repite el patrón si sobran filas). Sin selección →
   * llena hacia abajo desde la celda enfocada. Las tabulaciones llenan las
   * columnas editables siguientes. Solo pega en columnas editables y todo
   * queda como edición local (se confirma con "Aplicar").
   */
  const pegar = async (api: GridApi<FilaGrid>) => {
    if (deshabilitado) return
    let texto: string
    try {
      texto = await navigator.clipboard.readText()
    } catch {
      return
    }
    const lineas = texto.replace(/\r/g, '').split('\n')
    if (lineas.length > 0 && lineas[lineas.length - 1] === '') lineas.pop()
    if (lineas.length === 0) return
    const filasTxt = lineas.map((l) => l.split('\t'))

    // Columnas editables desde el foco hacia la derecha (si el foco está en
    // una no editable, arranca en la primera editable que siga).
    const foco = api.getFocusedCell()
    const cols = api.getAllDisplayedColumns()
    const idxFoco = cols.findIndex((c) => c.getColId() === (foco ? foco.column.getColId() : ''))
    const desde = idxFoco >= 0 && PARSEO[cols[idxFoco].getColId()] ? idxFoco : idxFoco + 1
    const colsEditables = cols.slice(desde).filter((c) => PARSEO[c.getColId()])
    if (colsEditables.length === 0) return

    // Destinos: seleccionadas en orden visual, o desde el foco hacia abajo.
    const sel = api.getSelectedNodes()
    const filaFoco = foco?.rowIndex ?? 0
    const destinos =
      sel.length > 0
        ? [...sel].sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0))
        : (Array.from({ length: api.getDisplayedRowCount() - filaFoco }, (_, i) =>
            api.getDisplayedRowAtIndex(filaFoco + i),
          ).filter(Boolean) as IRowNode<FilaGrid>[])

    destinos.forEach((nodo, i) => {
      if (!nodo?.data) return
      const campos: CamposAsignacion = {}
      filasTxt[i % filasTxt.length].forEach((crudo, k) => {
        const col = colsEditables[k]
        if (!col) return
        const p = PARSEO[col.getColId()](crudo)
        if (p) (campos as Record<string, unknown>)[p.campo] = p.valor
      })
      if (Object.keys(campos).length > 0) onEditar(nodo.data.id, campos)
    })
    // Al pegar, el "marquee" de copiado se apaga (igual que en Excel).
    if (copiadoRef.current) {
      copiadoRef.current = null
      api.refreshCells({ force: true })
    }
  }

  /**
   * Shift(+Ctrl)+flechas: mueve el foco y pinta el rectángulo ancla→foco
   * (solo esas celdas en azulito, no la fila entera). Las filas cubiertas
   * por el rango quedan marcadas para el "Aplicar a selección".
   */
  const extender = (api: GridApi<FilaGrid>, dF: -1 | 0 | 1, dC: -1 | 0 | 1, alBorde: boolean) => {
    const total = api.getDisplayedRowCount()
    if (total === 0) return
    const foco = api.getFocusedCell()
    const focoF = foco?.rowIndex ?? 0
    const colsNav = api.getAllDisplayedColumns().filter((c) => !COLS_NO_DATOS.has(c.getColId()))
    let iC = colsNav.findIndex((c) => c.getColId() === (foco ? foco.column.getColId() : ''))
    if (iC < 0) iC = 0
    const nuevoF = alBorde && dF !== 0 ? (dF === 1 ? total - 1 : 0) : Math.max(0, Math.min(total - 1, focoF + dF))
    const nuevoIC =
      dC === 0 ? iC : alBorde ? (dC === 1 ? colsNav.length - 1 : 0) : Math.max(0, Math.min(colsNav.length - 1, iC + dC))
    const nuevaCol = colsNav[nuevoIC].getColId()

    const ancla = rangoRef.current?.a ?? { f: focoF, c: colsNav[iC].getColId() }
    rangoRef.current = { a: ancla, b: { f: nuevoF, c: nuevaCol } }

    // Filas del rango → marcadas (solo las que el gesto agregó, para poder
    // contraer/deseleccionar sin tocar las que el usuario marcó a mano).
    const [fA, fB] = ancla.f <= nuevoF ? [ancla.f, nuevoF] : [nuevoF, ancla.f]
    const siguientes = new Set<string>()
    enGestoRango.current = true
    try {
      for (let i = fA; i <= fB; i++) {
        const n = api.getDisplayedRowAtIndex(i)
        if (!n?.data) continue
        // Solo rastrea lo que el gesto marcó: una fila ya seleccionada a mano
        // no entra a rangoIds → el colapso jamás la desmarca.
        if (rangoIdsRef.current.has(n.data.id) || !n.isSelected()) {
          siguientes.add(n.data.id)
          if (!n.isSelected()) n.setSelected(true)
        }
      }
      for (const id of rangoIdsRef.current) {
        if (!siguientes.has(id)) api.getRowNode(id)?.setSelected(false)
      }
    } finally {
      soltarGesto()
    }
    rangoIdsRef.current = siguientes
    api.setFocusedCell(nuevoF, nuevaCol)
    api.refreshCells({ force: true })
  }

  const alKeyDown = (e: ReactKeyboardEvent) => {
    const t = e.target as HTMLElement
    // Dentro de un editor de celda abierto, las teclas son del editor.
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
    const api = apiRef.current
    if (!api) return
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') {
      // Esc: apaga copiado y rango (como Excel).
      if (copiadoRef.current || rangoRef.current) {
        e.preventDefault()
        e.stopPropagation()
        copiadoRef.current = null
        limpiarRango(api, true)
        api.refreshCells({ force: true })
      }
    } else if (ctrl && k === 'a') {
      e.preventDefault()
      e.stopPropagation()
      api.selectAll()
    } else if (ctrl && k === 'c') {
      e.preventDefault()
      e.stopPropagation()
      copiar(api)
    } else if (ctrl && k === 'v') {
      e.preventDefault()
      e.stopPropagation()
      void pegar(api)
    } else if (e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault()
      e.stopPropagation()
      const dF = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
      const dC = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      extender(api, dF, dC, ctrl)
    } else if (!e.shiftKey && e.key.startsWith('Arrow')) {
      // Flecha sin Shift (como en Excel): la selección colapsa — se desmarcan
      // las filas que el gesto había marcado.
      limpiarRango(api, true)
    }
  }

  /** Ctrl+clic en una celda de datos: alterna la selección de ESA fila sin
   *  tocar las demás — para marcar salteadas, como Ctrl+clic en Excel. */
  const alClickCelda = (e: CellClickedEvent<FilaGrid>) => {
    const ev = e.event as MouseEvent | undefined
    if (!ev?.ctrlKey && !ev?.metaKey) return
    if (COLS_NO_DATOS.has(e.column.getColId())) return
    e.node.setSelected(!e.node.isSelected())
  }

  /** Soltar Shift termina el gesto: el rectángulo se suelta (la selección
   *  queda visible por los checkboxes) y un nuevo Shift+flecha arranca un
   *  rango nuevo desde la celda actual — igual que en Excel. */
  const alKeyUp = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Shift') return
    const api = apiRef.current
    if (api && rangoRef.current) {
      rangoRef.current = null
      api.refreshCells({ force: true })
    }
  }

  return (
    <div
      className="ma-grid"
      onKeyDownCapture={alKeyDown}
      onKeyUpCapture={alKeyUp}
      onMouseDownCapture={(e) => {
        // Clic dentro de la grilla: la selección del gesto colapsa (Excel) —
        // excepto con Ctrl, que agrega a la selección en vez de reiniciarla.
        const api = apiRef.current
        if (api && !e.ctrlKey && !e.metaKey) limpiarRango(api, true)
      }}
    >
      <AgGridReact<FilaGrid>
        theme={tema}
        rowData={rows}
        columnDefs={columnas}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: false }}
        getRowId={(p) => p.data.id}
        domLayout="autoHeight"
        rowSelection={{ mode: 'multiRow', enableClickSelection: false }}
        selectionColumnDef={{ width: 34, sortable: false, resizable: false, suppressMovable: true }}
        multiSortKey="ctrl"
        context={context}
        onGridReady={(e: GridReadyEvent<FilaGrid>) => {
          apiRef.current = e.api
          onGridReady(e.api)
        }}
        onSelectionChanged={alSeleccionar}
        onCellClicked={alClickCelda}
        onCellValueChanged={alCambiarCelda}
        enableCellTextSelection
        overlayNoRowsTemplate="<span style='color:#94a3b8;font-style:italic'>Sin objetivos</span>"
      />
    </div>
  )
}
