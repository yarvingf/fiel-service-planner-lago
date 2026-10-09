import { supabase, MENSAJE_FALTA_CONFIG } from './supabaseClient'
import type { Cuadrilla } from '@/domain/cuadrilla'
import type { Instalacion } from '@/domain/instalacion'
import type { PozoCompletacion, PozoConCompletaciones } from '@/domain/pozo'
import { ultimaVisitaPorPozo, type VisitaCampo } from '@/domain/visitaCampo'
import { calcularIndicadores, type IndicadorPozo } from '@/domain/indicadores'
import type { DiffUniverso, Universo } from './sincronizarUniverso'
import type { Database } from './database.types'

type FilaCuadrilla = Database['public']['Tables']['cuadrillas']['Row']
type FilaAsignacion = Database['public']['Tables']['asignaciones']['Row']
type InsertAsignacion = Database['public']['Tables']['asignaciones']['Insert']
type UpdateAsignacion = Database['public']['Tables']['asignaciones']['Update']
type FilaInstalacion = Database['public']['Tables']['instalaciones']['Row']
type FilaPozo = Database['public']['Tables']['pozos']['Row']
type FilaCompletacion = Database['public']['Tables']['pozo_completaciones']['Row']
type InsertCompletacion = Database['public']['Tables']['pozo_completaciones']['Insert']
type InsertImportCambio = Database['public']['Tables']['import_cambios']['Insert']
type FilaVisita = Database['public']['Tables']['visitas_campo']['Row']
type InsertVisita = Database['public']['Tables']['visitas_campo']['Insert']
type FilaIndicador = Database['public']['Tables']['pozo_indicadores']['Row']
type InsertIndicador = Database['public']['Tables']['pozo_indicadores']['Insert']

/** Una asignación ya traducida al modelo de la app (fecha en YYYY-MM-DD). */
export interface AsignacionRemota {
  /** uuid de la fila en la base — necesario para actualizar nota/actividad. */
  id: string
  fecha: string
  objetivoId: string
  codigo: string
  cuadrillaId: string
  actividad: string | null
  nota: string | null
  /** Número libre de prioridad para ordenar el plan del día. */
  prioridad: number | null
  /** Checklist operativo del plan (se exporta al Excel). */
  validarAjuste: boolean
  requiereManometro: boolean
  requiereNivel: boolean
}

/** Campos editables de una asignación (nombres en camelCase del modelo de la app). */
export interface CamposAsignacion {
  actividad?: string | null
  nota?: string | null
  prioridad?: number | null
  validarAjuste?: boolean
  requiereManometro?: boolean
  requiereNivel?: boolean
}

/** Traduce los campos camelCase a nombres de columna de la tabla. */
function camposAFila(campos: CamposAsignacion): UpdateAsignacion {
  const fila: UpdateAsignacion = {}
  if (campos.actividad !== undefined) fila.actividad = campos.actividad
  if (campos.nota !== undefined) fila.nota = campos.nota
  if (campos.prioridad !== undefined) fila.prioridad = campos.prioridad
  if (campos.validarAjuste !== undefined) fila.validar_ajuste = campos.validarAjuste
  if (campos.requiereManometro !== undefined) fila.requiere_manometro = campos.requiereManometro
  if (campos.requiereNivel !== undefined) fila.requiere_nivel = campos.requiereNivel
  return fila
}

export function filaACuadrilla(f: FilaCuadrilla): Cuadrilla {
  return { id: f.id, nombre: f.nombre, color: f.color, activa: f.activa }
}

export function filaAAsignacion(f: FilaAsignacion): AsignacionRemota {
  return {
    id: f.id,
    fecha: f.fecha,
    objetivoId: f.objetivo_id,
    codigo: f.objetivo_codigo,
    cuadrillaId: f.cuadrilla_id,
    actividad: f.actividad,
    nota: f.nota,
    prioridad: f.prioridad,
    validarAjuste: f.validar_ajuste,
    requiereManometro: f.requiere_manometro,
    requiereNivel: f.requiere_nivel,
  }
}

/** Traduce errores frecuentes de Postgres/RLS a mensajes accionables. */
function traducirError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('Ya existe un registro con ese nombre u objetivo')
  if (error.code === '42501' || /row-level security/i.test(error.message))
    return new Error('Tu usuario no tiene rol planificador: la base rechazó la escritura')
  return new Error(error.message)
}

function cliente() {
  if (!supabase) throw new Error(MENSAJE_FALTA_CONFIG)
  return supabase
}

export async function listarCuadrillas(): Promise<Cuadrilla[]> {
  const { data, error } = await cliente().from('cuadrillas').select('*').order('creado_en')
  if (error) throw traducirError(error)
  return (data ?? []).map(filaACuadrilla)
}

export async function crearCuadrilla(nombre: string, color: string): Promise<Cuadrilla> {
  const { data, error } = await cliente()
    .from('cuadrillas')
    .insert({ nombre, color })
    .select()
    .single()
  if (error) throw traducirError(error)
  return filaACuadrilla(data)
}

/** Borrado lógico: la cuadrilla se archiva (activa=false), no se borra.
 *  Sus asignaciones históricas conservan la referencia — en un plan viejo
 *  sigue leyéndose "estuvo con esta cuadrilla". */
export async function desactivarCuadrilla(id: string): Promise<void> {
  const { error } = await cliente().from('cuadrillas').update({ activa: false }).eq('id', id)
  if (error) throw traducirError(error)
}

/** Reactiva una cuadrilla archivada. Mismo id: sus asignaciones viejas
 *  vuelven a apuntar a ella automáticamente. */
export async function reactivarCuadrilla(id: string, color?: string): Promise<void> {
  const fila: { activa: boolean; color?: string } = { activa: true }
  if (color) fila.color = color
  const { error } = await cliente().from('cuadrillas').update(fila).eq('id', id)
  if (error) throw traducirError(error)
}

export async function listarAsignaciones(fecha: string): Promise<AsignacionRemota[]> {
  const { data, error } = await cliente()
    .from('asignaciones')
    .select('*')
    .eq('fecha', fecha)
    .order('creado_en')
  if (error) throw traducirError(error)
  return (data ?? []).map(filaAAsignacion)
}

/**
 * Inserta o reasigna: el índice único (fecha, objetivo_id) hace que un segundo
 * upsert del mismo objetivo actualice cuadrilla_id en vez de duplicar.
 * Devuelve las filas escritas (con su id real) para poblar el estado local.
 */
export async function guardarAsignaciones(
  fecha: string,
  cuadrillaId: string,
  objetivos: {
    objetivoId: string
    codigo: string
    validarAjuste?: boolean
    requiereManometro?: boolean
    requiereNivel?: boolean
  }[],
  asignadoPor: string,
): Promise<AsignacionRemota[]> {
  if (objetivos.length === 0) return []
  const filas: InsertAsignacion[] = objetivos.map((o) => ({
    fecha,
    cuadrilla_id: cuadrillaId,
    objetivo_id: o.objetivoId,
    objetivo_codigo: o.codigo,
    // Solo se envían los flags que el caller calculó (defaults por
    // indicadores para asignaciones nuevas, valores previos en
    // reasignaciones); los ausentes caen al default de la columna.
    ...(o.validarAjuste !== undefined ? { validar_ajuste: o.validarAjuste } : {}),
    ...(o.requiereManometro !== undefined ? { requiere_manometro: o.requiereManometro } : {}),
    ...(o.requiereNivel !== undefined ? { requiere_nivel: o.requiereNivel } : {}),
    asignado_por: asignadoPor,
  }))
  const { data, error } = await cliente()
    .from('asignaciones')
    .upsert(filas, { onConflict: 'fecha,objetivo_id' })
    .select()
  if (error) throw traducirError(error)
  return (data ?? []).map(filaAAsignacion)
}

/** Actualiza campos editables de una asignación existente (edición en el modal). */
export async function actualizarAsignacion(
  id: string,
  campos: CamposAsignacion,
): Promise<void> {
  const { error } = await cliente().from('asignaciones').update(camposAFila(campos)).eq('id', id)
  if (error) throw traducirError(error)
}

/** Aplica los mismos campos a varias asignaciones de golpe (copiar/pegar a la cuadrilla). */
export async function actualizarAsignaciones(
  ids: string[],
  campos: CamposAsignacion,
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await cliente().from('asignaciones').update(camposAFila(campos)).in('id', ids)
  if (error) throw traducirError(error)
}

export async function borrarAsignaciones(fecha: string, objetivoIds: string[]): Promise<void> {
  if (objetivoIds.length === 0) return
  const { error } = await cliente()
    .from('asignaciones')
    .delete()
    .eq('fecha', fecha)
    .in('objetivo_id', objetivoIds)
  if (error) throw traducirError(error)
}

/** Suelta TODO el día de una cuadrilla: borra sus asignaciones de `fecha`. */
export async function borrarAsignacionesCuadrilla(fecha: string, cuadrillaId: string): Promise<void> {
  const { error } = await cliente()
    .from('asignaciones')
    .delete()
    .eq('fecha', fecha)
    .eq('cuadrilla_id', cuadrillaId)
  if (error) throw traducirError(error)
}

/** Última fecha anterior a `fecha` que tiene alguna asignación (plantilla más reciente), o null. */
export async function ultimaFechaConPlan(fecha: string): Promise<string | null> {
  const { data, error } = await cliente()
    .from('asignaciones')
    .select('fecha')
    .lt('fecha', fecha)
    .order('fecha', { ascending: false })
    .limit(1)
  if (error) throw traducirError(error)
  return data?.[0]?.fecha ?? null
}

/** Un ítem de la plantilla copiada: asignación completa (con sus campos editables) para otra fecha. */
export interface ItemCopiaPlan {
  objetivoId: string
  codigo: string
  cuadrillaId: string
  actividad: string | null
  nota: string | null
  prioridad: number | null
  validarAjuste: boolean
  requiereManometro: boolean
  requiereNivel: boolean
}

/**
 * Replica asignaciones de otra fecha sobre `fechaDestino` conservando
 * actividad/nota/prioridad/checklist. El índice único (fecha, objetivo_id)
 * hace upsert: si el objetivo ya tenía dueño ese día, la copia lo reemplaza
 * (eso lo decide el usuario por fila en el preview).
 */
export async function copiarAsignaciones(
  fechaDestino: string,
  items: ItemCopiaPlan[],
  asignadoPor: string,
): Promise<AsignacionRemota[]> {
  if (items.length === 0) return []
  const filas: InsertAsignacion[] = items.map((i) => ({
    fecha: fechaDestino,
    cuadrilla_id: i.cuadrillaId,
    objetivo_id: i.objetivoId,
    objetivo_codigo: i.codigo,
    actividad: i.actividad,
    nota: i.nota,
    prioridad: i.prioridad,
    validar_ajuste: i.validarAjuste,
    requiere_manometro: i.requiereManometro,
    requiere_nivel: i.requiereNivel,
    asignado_por: asignadoPor,
  }))
  const { data, error } = await cliente()
    .from('asignaciones')
    .upsert(filas, { onConflict: 'fecha,objetivo_id' })
    .select()
  if (error) throw traducirError(error)
  return (data ?? []).map(filaAAsignacion)
}

// ---------------------------------------------------------------------------
// Universo pozos/instalaciones/completaciones (sync Excel ↔ Supabase, 0005)
// ---------------------------------------------------------------------------

const PAGINA = 1000

/**
 * PostgREST limita cada respuesta (~1000 filas); pagina hasta agotar. Pide
 * el total en la primera página (`count: 'exact'`, ver llamadores) y lanza
 * el resto de las páginas en paralelo en vez de una por una — con tablas
 * grandes (visitas_campo, ~10k filas) evita 10+ round-trips secuenciales.
 */
async function obtenerTodo<T>(
  armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { code?: string; message: string } | null }>,
): Promise<T[]> {
  const primera = await armar(0, PAGINA - 1)
  if (primera.error) throw traducirError(primera.error)
  const datos = primera.data ?? []
  const total = primera.count ?? datos.length
  if (total <= datos.length) return datos

  const restantes: ReturnType<typeof armar>[] = []
  for (let desde = PAGINA; desde < total; desde += PAGINA) restantes.push(armar(desde, desde + PAGINA - 1))
  const resultados = await Promise.all(restantes)

  const todo = [...datos]
  for (const r of resultados) {
    if (r.error) throw traducirError(r.error)
    todo.push(...(r.data ?? []))
  }
  return todo
}

function filaAInstalacion(f: FilaInstalacion): Instalacion {
  return {
    id: f.id,
    tipo: f.tipo,
    codigo: f.codigo,
    campo: f.campo,
    lat: f.lat,
    lon: f.lon,
    esStub: f.es_stub,
    activo: f.activo,
  }
}

function filaACompletacion(f: FilaCompletacion): PozoCompletacion {
  return {
    id: f.id,
    pozoId: f.pozo_id,
    nbYacimiento: f.nb_yacimiento,
    coa: f.coa,
    metodo: f.metodo,
    cat: f.cat,
    bnpd: f.bnpd,
    bnpdFecha: f.bnpd_fecha ? new Date(`${f.bnpd_fecha}T00:00:00`) : null,
    pot: f.pot,
    edo: f.edo,
  }
}

function filaAPozo(f: FilaPozo, completaciones: PozoCompletacion[]): PozoConCompletaciones {
  return {
    id: f.id,
    campo: f.campo,
    numero: f.numero,
    reemplazo: (f.reemplazo || null) as PozoConCompletaciones['reemplazo'],
    codigo: f.codigo,
    lat: f.lat,
    lon: f.lon,
    efId: f.ef_id,
    mgId: f.mg_id,
    pcId: f.pc_id,
    pbesId: f.pbes_id,
    reemplazado: f.reemplazado,
    activo: f.activo,
    completaciones,
  }
}

function instalacionAFila(i: Instalacion) {
  return {
    id: i.id, tipo: i.tipo, codigo: i.codigo, campo: i.campo,
    lat: i.lat, lon: i.lon, es_stub: i.esStub, activo: i.activo,
  }
}

function pozoAFila(p: PozoConCompletaciones) {
  return {
    id: p.id, campo: p.campo, numero: p.numero, reemplazo: (p.reemplazo ?? '') as Database['public']['Tables']['pozos']['Row']['reemplazo'],
    codigo: p.codigo, lat: p.lat, lon: p.lon,
    ef_id: p.efId, mg_id: p.mgId, pc_id: p.pcId, pbes_id: p.pbesId,
    reemplazado: p.reemplazado, activo: p.activo,
  }
}

function completacionAFila(c: PozoCompletacion): InsertCompletacion {
  return {
    id: c.id,
    pozo_id: c.pozoId,
    nb_yacimiento: c.nbYacimiento,
    coa: c.coa,
    metodo: c.metodo,
    cat: c.cat,
    bnpd: c.bnpd,
    bnpd_fecha: c.bnpdFecha ? c.bnpdFecha.toISOString().slice(0, 10) : null,
    pot: c.pot,
    edo: c.edo,
    // La sync es la fuente de verdad del Excel: si reescribe el coa, la marca
    // vuelve a 'excel' — solo queda 'mensaje' lo último tocado por el modal COA.
    coa_origen: 'excel',
    coa_fecha: null,
  }
}

/**
 * Aplica un estatus COA reportado por mensaje operativo a las completaciones
 * dadas (el modal marca TODAS las arenas del pozo con el estatus reportado).
 * Marca coa_origen='mensaje' + timestamp para distinguirlo del dato del Excel.
 */
export async function actualizarCoaCompletaciones(ids: string[], coa: 'Abierto' | 'Cerrado'): Promise<void> {
  if (ids.length === 0) return
  const { error } = await cliente()
    .from('pozo_completaciones')
    .update({ coa, coa_origen: 'mensaje', coa_fecha: new Date().toISOString() })
    .in('id', ids)
  if (error) throw traducirError(error)
}

function filaAVisita(f: FilaVisita): VisitaCampo {
  return {
    id: f.id,
    tipo: f.tipo,
    fecha: new Date(`${f.fecha}T00:00:00Z`),
    pozoTexto: f.pozo_texto,
    pozoId: f.pozo_id,
    cuadrilla: f.cuadrilla,
    campo: f.campo,
    tipoActividad: f.tipo_actividad,
    estadoInicial: f.estado_inicial,
    estadoFinal: f.estado_final,
    comentarios: f.comentarios,
    horaInicio: f.hora_inicio,
    horaFin: f.hora_fin,
    datosExtra: f.datos_extra ?? {},
  }
}

function visitaAFila(v: VisitaCampo): InsertVisita {
  return {
    id: v.id,
    tipo: v.tipo,
    fecha: v.fecha.toISOString().slice(0, 10),
    pozo_texto: v.pozoTexto,
    pozo_id: v.pozoId,
    cuadrilla: v.cuadrilla,
    campo: v.campo,
    tipo_actividad: v.tipoActividad,
    estado_inicial: v.estadoInicial,
    estado_final: v.estadoFinal,
    comentarios: v.comentarios,
    hora_inicio: v.horaInicio,
    hora_fin: v.horaFin,
    datos_extra: v.datosExtra,
  }
}

function filaAIndicador(f: FilaIndicador): IndicadorPozo {
  return {
    id: f.id,
    pozoId: f.pozo_id,
    fecha: f.fecha,
    indicador: f.indicador as IndicadorPozo['indicador'],
    valor: f.valor,
    visitaId: f.visita_id ?? '',
  }
}

function indicadorAFila(i: IndicadorPozo, pozoCodigo: string): InsertIndicador {
  return {
    id: i.id,
    pozo_id: i.pozoId,
    pozo_codigo: pozoCodigo,
    fecha: i.fecha,
    indicador: i.indicador,
    valor: i.valor,
    visita_id: i.visitaId,
  }
}

/**
 * Tabla reducida de indicadores — a diferencia del historial, SÍ se carga
 * completa al arranque: son ~miles de filas angostas y es lo que habilita
 * los filtros por evento sin tocar `visitas_campo`.
 */
export async function listarIndicadores(): Promise<IndicadorPozo[]> {
  const c = cliente()
  const filas = await obtenerTodo<FilaIndicador>((d, h) =>
    c.from('pozo_indicadores').select('*', { count: 'exact' }).range(d, h))
  return filas.map(filaAIndicador)
}

/** Columnas de visita necesarias para "última visita"/días sin visita — sin datos_extra ni actualizado_en. */
const COLUMNAS_VISITA_LIGERAS =
  'id,tipo,fecha,pozo_texto,pozo_id,cuadrilla,campo,tipo_actividad,estado_inicial,estado_final,comentarios,hora_inicio,hora_fin'

/**
 * Solo la ÚLTIMA visita por pozo — el arranque no necesita el historial
 * completo (~10k filas con JSONB pesado). Usa la vista `visitas_ultimas`
 * (migración 0011); si aún no existe en la base, cae a un select podado de
 * `visitas_campo` y reduce JS-side al mismo resultado — más tráfico, pero la
 * app funciona igual hasta correr la migración.
 */
async function obtenerVisitasRecientes(): Promise<VisitaCampo[]> {
  const c = cliente()
  const vista = await c.from('visitas_ultimas' as 'visitas_campo').select('*')
  if (!vista.error) return ((vista.data ?? []) as unknown as FilaVisita[]).map(filaAVisita)
  // Fallback sin migración: todas las filas pero sin datos_extra (la parte
  // pesada), reducidas a última-por-pozo.
  const filas = await obtenerTodo<FilaVisita>((d, h) =>
    c.from('visitas_campo').select(COLUMNAS_VISITA_LIGERAS, { count: 'exact' }).range(d, h) as never)
  return [...ultimaVisitaPorPozo(filas.map(filaAVisita)).values()]
}

/** Historial completo de UN pozo, más reciente primero — se pide bajo demanda al abrir su detalle. */
export async function listarVisitasPozo(pozoId: string): Promise<VisitaCampo[]> {
  const { data, error } = await cliente()
    .from('visitas_campo')
    .select('*')
    .eq('pozo_id', pozoId)
    .order('fecha', { ascending: false })
  if (error) throw traducirError(error)
  return (data ?? []).map(filaAVisita)
}

/**
 * El universo persistido: instalaciones + pozos con sus arenas + visitas.
 * Por defecto las visitas vienen reducidas a la última por pozo (arranque
 * liviano); `visitasCompletas: true` trae el historial entero — obligatorio
 * para calcular diffs de sincronización, que comparan por llave de negocio.
 */
export async function obtenerUniverso(opciones?: { visitasCompletas?: boolean }): Promise<Universo> {
  const c = cliente()
  const [instFilas, pozoFilas, compFilas, visitas] = await Promise.all([
    obtenerTodo<FilaInstalacion>((d, h) => c.from('instalaciones').select('*', { count: 'exact' }).range(d, h)),
    obtenerTodo<FilaPozo>((d, h) => c.from('pozos').select('*', { count: 'exact' }).range(d, h)),
    obtenerTodo<FilaCompletacion>((d, h) => c.from('pozo_completaciones').select('*', { count: 'exact' }).range(d, h)),
    opciones?.visitasCompletas
      ? obtenerTodo<FilaVisita>((d, h) => c.from('visitas_campo').select('*', { count: 'exact' }).range(d, h)).then((f) => f.map(filaAVisita))
      : obtenerVisitasRecientes(),
  ])
  const compsPorPozo = new Map<string, PozoCompletacion[]>()
  for (const f of compFilas) {
    const comp = filaACompletacion(f)
    const arr = compsPorPozo.get(comp.pozoId)
    if (arr) arr.push(comp)
    else compsPorPozo.set(comp.pozoId, [comp])
  }
  return {
    instalaciones: instFilas.map(filaAInstalacion),
    pozos: pozoFilas.map((f) => filaAPozo(f, compsPorPozo.get(f.id) ?? [])),
    visitas,
  }
}

const TANDA = 500
function enTandas<T>(arr: T[], tamano = TANDA): T[][] {
  const tandas: T[][] = []
  for (let i = 0; i < arr.length; i += tamano) tandas.push(arr.slice(i, i + tamano))
  return tandas
}

/**
 * Aplica un DiffUniverso a la base, en orden de dependencia:
 * tipos nuevos → instalaciones → pozos → completaciones → soft-deletes →
 * auditoría (importaciones + import_cambios).
 *
 * `nuevo` es el universo completo recién parseado (no solo el diff): se usa
 * para garantizar, de forma defensiva, que todo pozo referenciado por una
 * completación nueva/actualizada se upsertea aunque el diff no lo marcara
 * como cambiado — protege contra violar la FK pozo_completaciones→pozos si
 * la base de comparación de `calcularDiff` estuviera desactualizada.
 */
export async function aplicarDiffUniverso(
  diff: DiffUniverso,
  nuevo: Universo,
  archivo: string,
  nAlertas: number,
): Promise<void> {
  const c = cliente()

  // Pozos "tocados": los marcados nuevos/actualizados por el diff, más
  // cualquiera -aunque no haya cambiado a nivel de sus propios campos-
  // referenciado por una completación nueva/actualizada. Necesario para
  // garantizar su fila exista antes del paso 3 (FK pozo_completaciones→pozos)
  // incluso si la base de comparación de `calcularDiff` estuviera desfasada.
  const pozoPorId = new Map(nuevo.pozos.map((p) => [p.id, p]))
  const idsPozosTocados = new Set<string>()
  for (const p of diff.pozosNuevos) idsPozosTocados.add(p.id)
  for (const a of diff.pozosActualizados) idsPozosTocados.add(a.nuevo.id)
  for (const comp of diff.compsNuevas) idsPozosTocados.add(comp.pozoId)
  for (const a of diff.compsActualizadas) idsPozosTocados.add(a.nuevo.pozoId)
  const pozosTocados = [...idsPozosTocados]
    .map((id) => pozoPorId.get(id))
    .filter((p): p is PozoConCompletaciones => p !== undefined)

  // Mismo razonamiento un nivel arriba: instalaciones EF/MG/PC/PBES
  // referenciadas por esos pozos, aunque la instalación en sí no cambió.
  const instPorId = new Map(nuevo.instalaciones.map((i) => [i.id, i]))
  const idsInstTocadas = new Set<string>()
  for (const i of diff.instNuevas) idsInstTocadas.add(i.id)
  for (const a of diff.instActualizadas) idsInstTocadas.add(a.nuevo.id)
  for (const p of pozosTocados) {
    for (const id of [p.efId, p.mgId, p.pcId, p.pbesId]) if (id) idsInstTocadas.add(id)
  }
  const instTocadas = [...idsInstTocadas]
    .map((id) => instPorId.get(id))
    .filter((i): i is Instalacion => i !== undefined)

  // 0. Tipos de instalación nuevos en el Excel (el catálogo es abierto; el FK
  //    de instalaciones.tipo rechazaría un tipo aún no registrado).
  const tiposNuevos = [...new Set(instTocadas.map((i) => i.tipo))]
  if (tiposNuevos.length > 0) {
    const { error } = await c
      .from('tipos_instalacion')
      .upsert(tiposNuevos.map((t) => ({ codigo: t, descripcion: t })), { onConflict: 'codigo', ignoreDuplicates: true })
    if (error) throw traducirError(error)
  }

  // 1. Instalaciones: upsert de las tocadas; soft-delete del resto.
  const instUpsert = instTocadas.map(instalacionAFila)
  for (const tanda of enTandas(instUpsert)) {
    const { error } = await c.from('instalaciones').upsert(tanda, { onConflict: 'id' })
    if (error) throw traducirError(error)
  }
  if (diff.instDesactivadas.length > 0) {
    const { error } = await c
      .from('instalaciones')
      .update({ activo: false })
      .in('id', diff.instDesactivadas.map((i) => i.id))
    if (error) throw traducirError(error)
  }

  // 2. Pozos (ya existen las instalaciones que referencian).
  const pozosUpsert = pozosTocados.map(pozoAFila)
  for (const tanda of enTandas(pozosUpsert)) {
    const { error } = await c.from('pozos').upsert(tanda, { onConflict: 'id' })
    if (error) throw traducirError(error)
  }
  if (diff.pozosDesactivados.length > 0) {
    const { error } = await c
      .from('pozos')
      .update({ activo: false })
      .in('id', diff.pozosDesactivados.map((p) => p.id))
    if (error) throw traducirError(error)
  }

  // 3. Completaciones: upsert por la llave natural (pozo_id, nb_yacimiento) —
  //    el id posicional puede cambiar si reordenan filas del Excel.
  const compsUpsert = [...diff.compsNuevas, ...diff.compsActualizadas.map((a) => a.nuevo)].map(completacionAFila)
  for (const tanda of enTandas(compsUpsert)) {
    const { error } = await c
      .from('pozo_completaciones')
      .upsert(tanda, { onConflict: 'pozo_id,nb_yacimiento' })
    if (error) throw traducirError(error)
  }
  // Arenas eliminadas del Excel (el pozo sigue viniendo): borrado real por id
  // de la fila persistida — el diff ya trae el objeto previo con su id.
  for (const tanda of enTandas(diff.compsEliminadas)) {
    const { error } = await c
      .from('pozo_completaciones')
      .delete()
      .in('id', tanda.map((x) => x.id))
    if (error) throw traducirError(error)
  }

  // 4. Visitas de campo (GL/BES): bitácora, solo upsert — nunca se borran ni
  //    desactivan. `pozo_id` puede referenciar un pozo ya tocado arriba o
  //    uno preexistente sin cambios; en ambos casos ya existe en la base.
  // Lotes más chicos que el resto: cada visita lleva un `datos_extra` JSONB
  // con decenas de columnas (BES en particular) — 500 de golpe puede exceder
  // el statement_timeout de Supabase en la primera carga masiva.
  const visitasUpsert = [...diff.visitasNuevas, ...diff.visitasActualizadas.map((a) => a.nuevo)].map(visitaAFila)
  for (const tanda of enTandas(visitasUpsert, 100)) {
    const { error } = await c.from('visitas_campo').upsert(tanda, { onConflict: 'id' })
    if (error) throw traducirError(error)
  }

  // 4b. Reconstrucción de `pozo_indicadores`: es data derivada de TODAS las
  //     visitas del Excel recién importado, no del diff — se borra y se
  //     regenera entera (~miles de filas), lo que la hace idempotente ante
  //     re-imports y ante visitas que dejen de calificar por correcciones.
  const indicadores = calcularIndicadores(nuevo.visitas)
  {
    const { error } = await c.from('pozo_indicadores').delete().not('id', 'is', null)
    if (error) throw traducirError(error)
  }
  const codigoPozo = new Map(nuevo.pozos.map((p) => [p.id, p.codigo] as const))
  const indInsert = indicadores.map((i) => indicadorAFila(i, codigoPozo.get(i.pozoId) ?? ''))
  for (const tanda of enTandas(indInsert)) {
    const { error } = await c.from('pozo_indicadores').insert(tanda)
    if (error) throw traducirError(error)
  }

  // 5. Auditoría del import.
  const { data: imp, error: errorImp } = await c
    .from('importaciones')
    .insert({
      archivo,
      inst_nuevas: diff.instNuevas.length,
      inst_actualizadas: diff.instActualizadas.length,
      inst_desactivadas: diff.instDesactivadas.length,
      pozos_nuevos: diff.pozosNuevos.length,
      pozos_actualizados: diff.pozosActualizados.length,
      pozos_desactivados: diff.pozosDesactivados.length,
      comps_nuevas: diff.compsNuevas.length,
      comps_actualizadas: diff.compsActualizadas.length,
      comps_eliminadas: diff.compsEliminadas.length,
      visitas_nuevas: diff.visitasNuevas.length,
      visitas_actualizadas: diff.visitasActualizadas.length,
      n_alertas: nAlertas,
    })
    .select('id')
    .single()
  if (errorImp) throw traducirError(errorImp)

  const filasCambio: InsertImportCambio[] = []
  for (const cam of diff.cambios) {
    if (cam.campos && cam.campos.length > 0) {
      for (const f of cam.campos) {
        filasCambio.push({
          import_id: imp.id, entidad: cam.entidad, tipo: cam.tipo, clave: cam.clave,
          campo: f.campo, valor_antes: f.antes, valor_despues: f.despues,
        })
      }
    } else {
      filasCambio.push({ import_id: imp.id, entidad: cam.entidad, tipo: cam.tipo, clave: cam.clave })
    }
  }
  for (const tanda of enTandas(filasCambio)) {
    const { error } = await c.from('import_cambios').insert(tanda)
    if (error) throw traducirError(error)
  }
}
