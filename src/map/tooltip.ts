import { Popup, type Map as MaplibreMap, type MapLayerMouseEvent } from 'maplibre-gl'
import { ID_CAPA_POZOS, ID_CAPA_INSTALACIONES } from './capasMarcadores'
import { resaltarLineas } from './resaltado'
import { calcularDerivadosPozo, type PozoConCompletaciones } from '@/domain/pozo'
import { NOMBRES_TIPO_INSTALACION, type Instalacion } from '@/domain/instalacion'
import { ultimaVisitaPorPozo, type VisitaCampo } from '@/domain/visitaCampo'
import { useDatosStore } from '@/state/datosStore'
import { useAsignacionesStore, capturaPermite } from '@/state/asignacionesStore'

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('es-VE', { maximumFractionDigits: 1 })
}

function fmtFecha(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('es-VE')
}

// Lookups por id, reconstruidos cuando cambia versionDatos
let versionCache = -1
let pozosPorId = new Map<string, PozoConCompletaciones>()
let instPorId = new Map<string, Instalacion>()
let ultimaVisita = new Map<string, VisitaCampo>()

function refrescarCache(): void {
  const s = useDatosStore.getState()
  if (s.versionDatos === versionCache) return
  pozosPorId = new Map(s.pozos.map((p) => [p.id, p]))
  instPorId = new Map(s.instalaciones.map((i) => [i.id, i]))
  ultimaVisita = ultimaVisitaPorPozo(s.visitas)
  versionCache = s.versionDatos
}

function htmlPozo(p: PozoConCompletaciones): string {
  const d = calcularDerivadosPozo(p.completaciones)
  const ef = (p.efId && instPorId.get(p.efId)?.codigo) ?? '—'
  const mg = (p.mgId && instPorId.get(p.mgId)?.codigo) ?? '—'
  const ultimaFecha = p.completaciones
    .map((c) => c.bnpdFecha?.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0)
  const color = { Abierto: '#16a34a', Cerrado: '#dc2626', Indeterminado: '#9ca3af' }[d.estatus]
  // Marcador de antigüedad de visita: "hace N días" o "nunca" si el pozo no
  // tiene ninguna visita GL/BES registrada.
  const uv = ultimaVisita.get(p.id)
  const txtVisita = uv
    ? `hace <b>${Math.max(0, Math.floor((Date.now() - uv.fecha.getTime()) / 86_400_000))} d</b> · ${fmtFecha(uv.fecha)}`
    : '<b>nunca</b>'
  return `<div class="tt">
    <div class="tt-titulo">${esc(p.codigo)} <span class="tt-estatus" style="background:${color}">${d.estatus}</span></div>
    <div class="tt-fila">Campo ${esc(p.campo)} · ${esc(d.metodos.join(', ') || '—')} · CAT ${esc(d.categorias.join(', ') || '—')}</div>
    <div class="tt-fila">BNPD activo <b>${fmtNum(d.bnpdActivo)}</b> · Diferido <b>${fmtNum(d.potencialDiferidoConfirmado)}</b>${d.diferidoIncompleto ? ' ⚠ incompleto' : ''}</div>
    <div class="tt-fila">EF ${esc(ef)} · MG ${esc(mg)}</div>
    <div class="tt-fila">Últ. medición ${ultimaFecha ? fmtFecha(new Date(ultimaFecha)) : '—'}</div>
    <div class="tt-fila">Últ. visita ${txtVisita}</div>
  </div>`
}

function htmlInstalacion(i: Instalacion): string {
  const nombre = NOMBRES_TIPO_INSTALACION[i.tipo] ?? i.tipo
  return `<div class="tt">
    <div class="tt-titulo">${esc(i.codigo)}</div>
    <div class="tt-fila">${esc(i.tipo)} — ${esc(nombre)}</div>
    <div class="tt-fila">Campo ${esc(i.campo)}</div>
  </div>`
}

/**
 * Tooltip al hover + cursor pointer sobre pozos e instalaciones.
 * El HTML se construye desde el dominio (no desde las properties de la feature)
 * para no inflar el GeoJSON con el desglose por arena.
 */
export function conectarTooltip(map: MaplibreMap): void {
  const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: '320px' })
  let hoveredId: string | null = null

  const alMover = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) return
    const id = String(f.properties?.['id'] ?? '')
    const kind = f.properties?.['kind']
    if (id === hoveredId) {
      popup.setLngLat(e.lngLat)
      return
    }
    hoveredId = id
    refrescarCache()
    const html = kind === 'pozo'
      ? (pozosPorId.get(id) ? htmlPozo(pozosPorId.get(id)!) : '')
      : (instPorId.get(id) ? htmlInstalacion(instPorId.get(id)!) : '')
    if (html) popup.setLngLat(e.lngLat).setHTML(html).addTo(map)
    // Resalta las líneas de este pozo/EF/MG y atenúa el resto — distingue
    // grupos sin necesitar una paleta de color por MG (ilegible si hay muchos).
    const codigo = kind === 'pozo' ? pozosPorId.get(id)?.codigo : instPorId.get(id)?.codigo
    resaltarLineas(map, codigo ?? null)
  }

  const alSalir = () => {
    hoveredId = null
    popup.remove()
    map.getCanvas().style.cursor = ''
    resaltarLineas(map, null)
  }

  for (const capa of [ID_CAPA_POZOS, ID_CAPA_INSTALACIONES]) {
    map.on('mousemove', capa, alMover)
    map.on('mouseenter', capa, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', capa, alSalir)
  }
}

/**
 * Click en un marcador → selección en el store (la lee el panel de detalle).
 * En modo 'multi' el clic alterna el objetivo en la selección de asignación:
 * suma si respeta la captura, quita si ya estaba seleccionado.
 */
export function conectarSeleccion(map: MaplibreMap): void {
  const alClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) return
    const kind = f.properties?.['kind'] === 'pozo' ? 'pozo' : 'instalacion'
    const id = String(f.properties?.['id'] ?? '')
    if (!id) return
    const asig = useAsignacionesStore.getState()
    if (asig.modoSeleccion === 'multi') {
      const objetivoId = `${kind === 'pozo' ? 'pozo' : 'inst'}|${id}`
      if (asig.seleccion.includes(objetivoId) || capturaPermite(asig.captura, kind, f.properties?.['tipo'])) {
        asig.alternarObjetivo(objetivoId)
      }
      // Si "multi" se activó para un solo uso (clic derecho), un clic ya lo agota.
      asig.consumirUnaVez()
      return
    }
    useDatosStore.getState().seleccionar({ kind, id })
  }
  map.on('click', ID_CAPA_POZOS, alClick)
  map.on('click', ID_CAPA_INSTALACIONES, alClick)
}
