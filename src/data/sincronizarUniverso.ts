import type { Instalacion } from '@/domain/instalacion'
import type { PozoCompletacion, PozoConCompletaciones } from '@/domain/pozo'
import type { VisitaCampo } from '@/domain/visitaCampo'

/**
 * Diff entre el universo recién parseado del Excel y el persistido en
 * Supabase. Se compara el RESULTADO normalizado (no las filas crudas), así que
 * detecta igual los dos flujos de consolidación: filas nuevas agregadas al
 * final y correcciones/actualizaciones sobre filas anteriores.
 *
 * Reglas:
 * - Instalaciones/pozos se comparan por su id determinista.
 * - Completaciones por la llave natural (pozo_id, nb_yacimiento) — su id es
 *   posicional y puede cambiar si reordenan filas del Excel.
 * - Lo que no viene en el Excel nuevo se marca activo=false (soft-delete),
 *   nunca se borra: preserva historial de asignaciones y reemplazos.
 * - Excepción: completaciones cuya arena desaparece (el pozo sigue viniendo)
 *   sí se eliminan — son dato de medición, no historial operativo.
 * - Visitas de campo (GL/BES) se comparan por su llave de negocio
 *   (tipo, fecha, pozo, cuadrilla) = su id determinista. Solo nuevo/actualizado
 *   — es una bitácora que solo crece, nunca se "desactiva" una visita vieja.
 */

export interface Universo {
  instalaciones: Instalacion[]
  pozos: PozoConCompletaciones[]
  visitas: VisitaCampo[]
}

export interface CambioCampo {
  campo: string
  antes: string | null
  despues: string | null
}

/** Una entrada del detalle (preview en el modal + filas de import_cambios). */
export interface CambioEntidad {
  entidad: 'instalacion' | 'pozo' | 'completacion' | 'visita'
  tipo: 'nuevo' | 'actualizado' | 'desactivado' | 'eliminado'
  /** Identificador legible: "BA 0345", "EF-BA-17", "BA 0345 · ARENA-12". */
  clave: string
  campos?: CambioCampo[]
}

export interface Actualizado<T> {
  previo: T
  nuevo: T
  campos: CambioCampo[]
}

export interface DiffUniverso {
  instNuevas: Instalacion[]
  instActualizadas: Actualizado<Instalacion>[]
  instDesactivadas: Instalacion[]
  pozosNuevos: PozoConCompletaciones[]
  pozosActualizados: Actualizado<PozoConCompletaciones>[]
  pozosDesactivados: PozoConCompletaciones[]
  compsNuevas: PozoCompletacion[]
  compsActualizadas: Actualizado<PozoCompletacion>[]
  compsEliminadas: PozoCompletacion[]
  visitasNuevas: VisitaCampo[]
  visitasActualizadas: Actualizado<VisitaCampo>[]
  cambios: CambioEntidad[]
  vacio: boolean
}

const EPS = 1e-9
const numEq = (a: number | null, b: number | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < EPS)

const fmt = (v: string | number | boolean | null): string | null =>
  v === null || v === undefined ? null : String(v)

function comparar(
  pares: [campo: string, a: string | number | boolean | null, b: string | number | boolean | null][],
): CambioCampo[] {
  const campos: CambioCampo[] = []
  for (const [campo, a, b] of pares) {
    const iguales = typeof a === 'number' || typeof b === 'number'
      ? numEq(a as number | null, b as number | null)
      : a === b
    if (!iguales) campos.push({ campo, antes: fmt(a), despues: fmt(b) })
  }
  return campos
}

const fechaIso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

/**
 * JSON con claves ordenadas alfabéticamente — a diferencia de JSON.stringify
 * plano, dos objetos con el mismo contenido dan el mismo texto sin importar
 * el orden de inserción. Necesario porque Postgres/JSONB NO conserva el
 * orden original de las claves al guardar y devolver `datos_extra`: sin esto,
 * cada visita se marcaba como "actualizada" en cada sync aunque nada hubiera
 * cambiado, solo por el reordenamiento.
 */
function jsonEstable(v: Record<string, string | number | boolean>): string {
  const claves = Object.keys(v).sort()
  return `{${claves.map((k) => `${JSON.stringify(k)}:${JSON.stringify(v[k])}`).join(',')}}`
}

export function calcularDiff(nuevo: Universo, actual: Universo): DiffUniverso {
  const cambios: CambioEntidad[] = []

  // --- Instalaciones (por id) ---
  const instActualPorId = new Map(actual.instalaciones.map((i) => [i.id, i]))
  const instNuevas: Instalacion[] = []
  const instActualizadas: Actualizado<Instalacion>[] = []
  for (const i of nuevo.instalaciones) {
    const prev = instActualPorId.get(i.id)
    if (!prev) {
      instNuevas.push(i)
      cambios.push({ entidad: 'instalacion', tipo: 'nuevo', clave: i.codigo })
      continue
    }
    const campos = comparar([
      ['tipo', prev.tipo, i.tipo],
      ['codigo', prev.codigo, i.codigo],
      ['campo', prev.campo, i.campo],
      ['lat', prev.lat, i.lat],
      ['lon', prev.lon, i.lon],
      ['es_stub', prev.esStub, i.esStub],
      ['activo', prev.activo, i.activo],
    ])
    if (campos.length > 0) {
      instActualizadas.push({ previo: prev, nuevo: i, campos })
      cambios.push({ entidad: 'instalacion', tipo: 'actualizado', clave: i.codigo, campos })
    }
  }
  const instNuevasIds = new Set(nuevo.instalaciones.map((i) => i.id))
  const instDesactivadas = actual.instalaciones.filter((i) => i.activo && !instNuevasIds.has(i.id))
  for (const i of instDesactivadas) {
    cambios.push({ entidad: 'instalacion', tipo: 'desactivado', clave: i.codigo })
  }

  // --- Pozos (por id) ---
  const pozoActualPorId = new Map(actual.pozos.map((p) => [p.id, p]))
  const pozosNuevos: PozoConCompletaciones[] = []
  const pozosActualizados: Actualizado<PozoConCompletaciones>[] = []
  for (const p of nuevo.pozos) {
    const prev = pozoActualPorId.get(p.id)
    if (!prev) {
      pozosNuevos.push(p)
      cambios.push({ entidad: 'pozo', tipo: 'nuevo', clave: p.codigo })
      continue
    }
    const campos = comparar([
      ['codigo', prev.codigo, p.codigo],
      ['lat', prev.lat, p.lat],
      ['lon', prev.lon, p.lon],
      ['EF', prev.efId, p.efId],
      ['MG', prev.mgId, p.mgId],
      ['PC', prev.pcId, p.pcId],
      ['PBES', prev.pbesId, p.pbesId],
      ['reemplazado', prev.reemplazado, p.reemplazado],
      ['activo', prev.activo, p.activo],
    ])
    if (campos.length > 0) {
      pozosActualizados.push({ previo: prev, nuevo: p, campos })
      cambios.push({ entidad: 'pozo', tipo: 'actualizado', clave: p.codigo, campos })
    }
  }
  const pozosNuevosIds = new Set(nuevo.pozos.map((p) => p.id))
  const pozosDesactivados = actual.pozos.filter((p) => p.activo && !pozosNuevosIds.has(p.id))
  for (const p of pozosDesactivados) {
    cambios.push({ entidad: 'pozo', tipo: 'desactivado', clave: p.codigo })
  }

  // --- Completaciones (por pozo_id + nb_yacimiento) ---
  // Solo se comparan arenas de pozos que siguen viniendo en el Excel; las de
  // pozos desactivados se conservan intactas junto con su historial.
  const pozoPorId = new Map(nuevo.pozos.map((p) => [p.id, p]))
  const claveComp = (c: PozoCompletacion) => `${c.pozoId}|${c.nbYacimiento}`
  const etiquetaComp = (c: PozoCompletacion): string => {
    const cod = pozoPorId.get(c.pozoId)?.codigo ?? pozoActualPorId.get(c.pozoId)?.codigo ?? c.pozoId
    return `${cod} · ${c.nbYacimiento || '(sin yacimiento)'}`
  }

  const compActualPorClave = new Map<string, PozoCompletacion>()
  for (const p of actual.pozos) {
    if (!pozoPorId.has(p.id)) continue // pozo desapareció → su historia queda
    for (const c of p.completaciones) compActualPorClave.set(claveComp(c), c)
  }

  const compsNuevas: PozoCompletacion[] = []
  const compsActualizadas: Actualizado<PozoCompletacion>[] = []
  const clavesNuevas = new Set<string>()
  for (const p of nuevo.pozos) {
    for (const c of p.completaciones) {
      clavesNuevas.add(claveComp(c))
      const prev = compActualPorClave.get(claveComp(c))
      if (!prev) {
        compsNuevas.push(c)
        cambios.push({ entidad: 'completacion', tipo: 'nuevo', clave: etiquetaComp(c) })
        continue
      }
      const campos = comparar([
        ['COA', prev.coa, c.coa],
        ['METODO', prev.metodo, c.metodo],
        ['CAT', prev.cat, c.cat],
        ['BNPD', prev.bnpd, c.bnpd],
        ['BNPD_FE', fechaIso(prev.bnpdFecha), fechaIso(c.bnpdFecha)],
        ['POT', prev.pot, c.pot],
        ['EDO', prev.edo, c.edo],
      ])
      if (campos.length > 0) {
        compsActualizadas.push({ previo: prev, nuevo: c, campos })
        cambios.push({ entidad: 'completacion', tipo: 'actualizado', clave: etiquetaComp(c), campos })
      }
    }
  }
  const compsEliminadas = [...compActualPorClave.entries()]
    .filter(([k]) => !clavesNuevas.has(k))
    .map(([, c]) => c)
  for (const c of compsEliminadas) {
    cambios.push({ entidad: 'completacion', tipo: 'eliminado', clave: etiquetaComp(c) })
  }

  // --- Visitas de campo (por id = llave de negocio tipo+fecha+pozo+cuadrilla) ---
  // Bitácora que solo crece: no hay "desactivadas" — una visita que ya no
  // aparece en el Excel simplemente se queda como estaba (no se toca).
  const visitaActualPorId = new Map(actual.visitas.map((v) => [v.id, v]))
  const visitasNuevas: VisitaCampo[] = []
  const visitasActualizadas: Actualizado<VisitaCampo>[] = []
  for (const v of nuevo.visitas) {
    const prev = visitaActualPorId.get(v.id)
    const etiqueta = `${v.pozoTexto} · ${fechaIso(v.fecha)} (${v.tipo})`
    if (!prev) {
      visitasNuevas.push(v)
      cambios.push({ entidad: 'visita', tipo: 'nuevo', clave: etiqueta })
      continue
    }
    const campos = comparar([
      ['pozoId', prev.pozoId, v.pozoId],
      ['actividad', prev.tipoActividad, v.tipoActividad],
      ['estadoInicial', prev.estadoInicial, v.estadoInicial],
      ['estadoFinal', prev.estadoFinal, v.estadoFinal],
      ['horaInicio', prev.horaInicio, v.horaInicio],
      ['horaFin', prev.horaFin, v.horaFin],
      ['comentarios', prev.comentarios, v.comentarios],
      // El resto de las decenas de lecturas específicas (GL/BES) se compara
      // en bloque — detallarlas campo a campo no aporta al preview del sync.
      ['datosExtra', jsonEstable(prev.datosExtra), jsonEstable(v.datosExtra)],
    ])
    if (campos.length > 0) {
      visitasActualizadas.push({ previo: prev, nuevo: v, campos })
      cambios.push({ entidad: 'visita', tipo: 'actualizado', clave: etiqueta, campos })
    }
  }

  const vacio =
    instNuevas.length === 0 && instActualizadas.length === 0 && instDesactivadas.length === 0 &&
    pozosNuevos.length === 0 && pozosActualizados.length === 0 && pozosDesactivados.length === 0 &&
    compsNuevas.length === 0 && compsActualizadas.length === 0 && compsEliminadas.length === 0 &&
    visitasNuevas.length === 0 && visitasActualizadas.length === 0

  return {
    instNuevas, instActualizadas, instDesactivadas,
    pozosNuevos, pozosActualizados, pozosDesactivados,
    compsNuevas, compsActualizadas, compsEliminadas,
    visitasNuevas, visitasActualizadas,
    cambios, vacio,
  }
}
