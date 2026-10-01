import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDatosStore } from '@/state/datosStore'
import { useAsignacionesStore, type IdObjetivo } from '@/state/asignacionesStore'

// Los modales solo se descargan al abrirlos por primera vez (chunks aparte).
const ModalCoa = lazy(() => import('./ModalCoa').then((m) => ({ default: m.ModalCoa })))
const ModalListaPozos = lazy(() => import('./ModalListaPozos').then((m) => ({ default: m.ModalListaPozos })))
import { HerramientaMenu } from './HerramientaMenu'
import { CapturaMenu } from './CapturaMenu'
import { mapaInstancia } from '@/map/mapaInstancia'
import { exportarAlertasExcel } from '@/data/exportarAlertas'
import { NOMBRES_TIPO_INSTALACION } from '@/domain/instalacion'
import './BarraHerramientas.css'

const norm = (s: string) => s.toUpperCase().replace(/[\s\-_]+/g, '')

interface Resultado {
  kind: 'pozo' | 'instalacion'
  id: string
  codigo: string
  detalle: string
  lon: number
  lat: number
}

/** Prioridad: código exacto > empieza igual > contiene > campos asociados. */
function puntaje(q: string, codigo: string, extra: string): number {
  const c = norm(codigo)
  if (c === q) return 4
  if (c.startsWith(q)) return 3
  if (c.includes(q)) return 2
  if (extra.toUpperCase().includes(q.toUpperCase())) return 1
  return 0
}

const objetivoIdDe = (r: Resultado): IdObjetivo => `${r.kind === 'pozo' ? 'pozo' : 'inst'}|${r.id}`

export function BarraHerramientas() {
  const { pozos, instalaciones, alertas, cargando, error, prepararSincronizacion, seleccionar } = useDatosStore()
  const {
    cuadrillas, cuadrillaActiva, asignaciones, fecha, seleccion,
    alternarObjetivo, agregarASeleccion, iniciarAsignacion,
  } = useAsignacionesStore()
  const [query, setQuery] = useState('')
  const [activo, setActivo] = useState(0)
  const [modalCoa, setModalCoa] = useState(false)
  const [modalLista, setModalLista] = useState(false)
  const inputArchivo = useRef<HTMLInputElement>(null)
  const inputBusqueda = useRef<HTMLInputElement>(null)

  // Ctrl+K (o `/` fuera de campos de texto) enfoca el buscador desde cualquier
  // parte de la app — estándar de Paleta de comandos.
  useEffect(() => {
    const esCampoTexto = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const alBajar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputBusqueda.current?.focus()
        inputBusqueda.current?.select()
      } else if (e.key === '/' && !esCampoTexto(e.target)) {
        e.preventDefault()
        inputBusqueda.current?.focus()
      }
    }
    window.addEventListener('keydown', alBajar)
    return () => window.removeEventListener('keydown', alBajar)
  }, [])
  const instPorId = useMemo(() => new Map(instalaciones.map((i) => [i.id, i])), [instalaciones])

  const selSet = useMemo(() => new Set(seleccion), [seleccion])
  const cuadrillaPorId = useMemo(() => new Map(cuadrillas.map((c) => [c.id, c])), [cuadrillas])
  const cuadrillaNombre = cuadrillaActiva ? cuadrillaPorId.get(cuadrillaActiva)?.nombre : undefined
  /** objetivoId → asignación del día, para marcar a quién pertenece cada resultado. */
  const asignacionHoy = useMemo(() => {
    const m = new Map<IdObjetivo, string>()
    for (const a of asignaciones) if (a.fecha === fecha) m.set(a.objetivoId, a.cuadrillaId)
    return m
  }, [asignaciones, fecha])

  const resultados = useMemo<Resultado[]>(() => {
    const q = norm(query.trim())
    if (q.length < 2) return []
    const hits: { r: Resultado; p: number }[] = []
    for (const p of pozos) {
      if (p.reemplazado || p.lat === null || p.lon === null) continue
      const ef = (p.efId && instPorId.get(p.efId)?.codigo) ?? ''
      const mg = (p.mgId && instPorId.get(p.mgId)?.codigo) ?? ''
      const yacs = p.completaciones.map((c) => c.nbYacimiento).join(' ')
      const pts = puntaje(q, p.codigo, `${ef} ${mg} ${yacs}`)
      if (pts > 0) {
        hits.push({
          p: pts,
          r: { kind: 'pozo', id: p.id, codigo: p.codigo, detalle: `Campo ${p.campo} · ${ef || 'sin EF'} · ${mg || 'sin MG'}`, lon: p.lon, lat: p.lat },
        })
      }
    }
    for (const i of instalaciones) {
      if (i.lat === null || i.lon === null) continue
      const pts = puntaje(q, i.codigo, `${i.tipo} ${NOMBRES_TIPO_INSTALACION[i.tipo] ?? ''}`)
      if (pts > 0) {
        hits.push({
          p: pts,
          r: { kind: 'instalacion', id: i.id, codigo: i.codigo, detalle: `${i.tipo} — ${NOMBRES_TIPO_INSTALACION[i.tipo] ?? ''} · Campo ${i.campo}`, lon: i.lon, lat: i.lat },
        })
      }
    }
    hits.sort((a, b) => b.p - a.p || a.r.codigo.localeCompare(b.r.codigo))
    return hits.slice(0, 10).map((h) => h.r)
  }, [query, pozos, instalaciones, instPorId])

  const irA = (r: Resultado) => {
    const map = mapaInstancia.current
    // Solo acercar, nunca alejar: con zoom fijo el vuelo "alejaba" si el
    // usuario ya estaba más cerca que 14 — se sentía como un salto errático.
    map?.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 900 })
    seleccionar({ kind: r.kind, id: r.id })
    setQuery('')
  }

  const alArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    // Parsea y calcula el diff contra Supabase; no escribe nada todavía —
    // el modal de preview (ModalSincronizacion) confirma o cancela.
    if (file) await prepararSincronizacion(file)
  }

  return (
    <>
    <div className="barra-herramientas">
      <div className="bh-busqueda">
        <input
          ref={inputBusqueda}
          type="text"
          value={query}
          placeholder="Buscar pozo o instalación (BA 345, VLC, EF-BA-17, MG...) — Ctrl+K"
          onChange={(e) => { setQuery(e.target.value); setActivo(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && resultados.length > 0) {
              e.preventDefault()
              setActivo((a) => Math.min(a + 1, resultados.length - 1))
            } else if (e.key === 'ArrowUp' && resultados.length > 0) {
              e.preventDefault()
              setActivo((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && resultados.length > 0) {
              irA(resultados[activo] ?? resultados[0])
            } else if (e.key === 'Escape') {
              setQuery('')
              inputBusqueda.current?.blur()
            }
          }}
        />
        {resultados.length > 0 && (
          <ul className="bh-resultados">
            {resultados.length > 1 && (
              <li className="bh-res-todos">
                <button
                  type="button"
                  onClick={() => agregarASeleccion(resultados.map(objetivoIdDe))}
                >
                  + Añadir los {resultados.length} a la selección
                </button>
              </li>
            )}
            {resultados.map((r, i) => {
              const oid = objetivoIdDe(r)
              const enSeleccion = selSet.has(oid)
              const dueno = asignacionHoy.get(oid)
              const cuadrillaDe = dueno ? cuadrillaPorId.get(dueno) : undefined
              const yaDeActiva = dueno !== undefined && dueno === cuadrillaActiva
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    className={`bh-res${i === activo ? ' bh-res-activo' : ''}`}
                    onMouseEnter={() => setActivo(i)}
                    ref={i === activo ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                    onClick={() => irA(r)}
                  >
                    <b>
                      {cuadrillaDe && (
                        <i
                          className="bh-res-punto"
                          style={{ background: cuadrillaDe.color }}
                          title={`Asignado a ${cuadrillaDe.nombre}`}
                        />
                      )}
                      {r.codigo}
                    </b>
                    <span>{r.detalle}</span>
                  </button>
                  <button
                    type="button"
                    className={`bh-res-acc${enSeleccion ? ' bh-res-acc-on' : ''}`}
                    title={enSeleccion ? 'Quitar de la selección' : 'Añadir a la selección'}
                    onClick={() => alternarObjetivo(oid)}
                  >
                    {enSeleccion ? '✓' : '+'}
                  </button>
                  {cuadrillaActiva && (
                    <button
                      type="button"
                      className="bh-res-acc bh-res-asignar"
                      disabled={yaDeActiva}
                      title={
                        yaDeActiva
                          ? `Ya asignado a ${cuadrillaNombre}`
                          : `Asignar a ${cuadrillaNombre ?? 'la cuadrilla activa'}`
                      }
                      onClick={() => iniciarAsignacion([oid])}
                    >
                      {yaDeActiva ? '✓' : '→'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <HerramientaMenu />
      <CapturaMenu />

      <button
        type="button"
        className="bh-boton"
        title="Pegar mensaje COA (🟢/🔴) para actualizar estatus de pozos"
        onClick={() => setModalCoa(true)}
      >
        🟢🔴 Estatus
      </button>

      <button
        type="button"
        className="bh-boton"
        title="Pegar una lista o texto con pozos para seleccionarlos en el mapa"
        onClick={() => setModalLista(true)}
      >
        📋 Lista
      </button>

      <button
        type="button"
        className="bh-boton"
        disabled={cargando}
        onClick={() => inputArchivo.current?.click()}
      >
        {cargando ? 'Analizando…' : 'Importar Excel'}
      </button>
      <input
        ref={inputArchivo}
        type="file"
        accept=".xlsx,.csv"
        hidden
        onChange={(e) => void alArchivo(e)}
      />

      <button
        type="button"
        className="bh-boton bh-boton-alertas"
        disabled={alertas.length === 0}
        title="Descargar reporte de alertas del último import"
        onClick={() => void exportarAlertasExcel(alertas)}
      >
        Alertas ({alertas.length})
      </button>
    </div>

    {error && (
      <div className="bh-error" role="alert">
        {error}
        <button type="button" onClick={() => useDatosStore.setState({ error: null })} aria-label="Cerrar">×</button>
      </div>
    )}

    {modalCoa &&
      createPortal(
        <Suspense fallback={null}>
          <ModalCoa onCerrar={() => setModalCoa(false)} />
        </Suspense>,
        document.body,
      )}
    {modalLista &&
      createPortal(
        <Suspense fallback={null}>
          <ModalListaPozos onCerrar={() => setModalLista(false)} />
        </Suspense>,
        document.body,
      )}
    </>
  )
}
