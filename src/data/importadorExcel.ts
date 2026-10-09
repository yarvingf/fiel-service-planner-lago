// Solo tipos en el top-level: el runtime de ExcelJS (pesado) se importa de
// forma dinámica dentro de importarExcel(), así no viaja en el bundle
// inicial — se descarga solo cuando el usuario realmente importa un archivo.
import type ExcelJS from 'exceljs'
import {
  claveNormalizadaEF,
  claveNormalizadaInstalacion,
  claveNormalizadaMG,
  clavePozoFisico,
  esCampoValido,
  esValorNulo,
  parsearCodigoPozo,
  type Campo,
} from '@/domain/codigos'
import {
  debeAlertarPorFaltaDeMg,
  type EstatusCoa,
  type Metodo,
  type Pozo,
  type PozoCompletacion,
  type PozoConCompletaciones,
} from '@/domain/pozo'
import { esTipoInstalacionConocido, type Instalacion } from '@/domain/instalacion'
import { coordenadasFueraDeRango, crearAlerta, type AlertaImport } from '@/domain/alertasImport'
import { claveVisita, type TipoVisita, type VisitaCampo } from '@/domain/visitaCampo'
import { calcularIndicadores, type IndicadorPozo } from '@/domain/indicadores'

export interface ResultadoImport {
  pozos: PozoConCompletaciones[]
  instalaciones: Instalacion[]
  visitas: VisitaCampo[]
  /** Proyección reducida de `visitas` para filtrado (tabla pozo_indicadores). */
  indicadores: IndicadorPozo[]
  alertas: AlertaImport[]
}

// --- Lectura de celdas ExcelJS (valores crudos, fórmulas, rich text) ---

export type ValorCelda = string | number | boolean | Date | null

function valorCelda(cell: ExcelJS.Cell): ValorCelda {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return (v.result as ValorCelda) ?? null
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return String(v.text)
    return null
  }
  return v as ValorCelda
}

function texto(v: ValorCelda): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Parsea número; devuelve {valor, ok:false} si la celda tenía contenido no numérico. */
function numero(v: ValorCelda): { valor: number | null; ok: boolean } {
  if (v === null || v === undefined || v === '') return { valor: null, ok: true }
  if (typeof v === 'number') return { valor: v, ok: true }
  const n = Number(String(v).replace(',', '.'))
  return isNaN(n) ? { valor: null, ok: false } : { valor: n, ok: true }
}

/**
 * Sanea un par lat/lon antes de usarlo: si cae fuera del rango del lago pero
 * el par invertido (lon, lat) sí cae dentro, las columnas venían cambiadas —
 * se intercambian y se alerta. Si ni así entra en rango, se descartan a null:
 * un marcador en coordenadas basura queda dibujado en cualquier parte del
 * mundo y el flyTo del buscador lleva al usuario a un lugar errado.
 */
export function normalizarCoordenadas(
  lat: number | null,
  lon: number | null,
): { lat: number | null; lon: number | null; invertidas: boolean; fuera: boolean } {
  if (lat === null || lon === null) return { lat, lon, invertidas: false, fuera: false }
  if (!coordenadasFueraDeRango(lat, lon)) return { lat, lon, invertidas: false, fuera: false }
  if (!coordenadasFueraDeRango(lon, lat)) return { lat: lon, lon: lat, invertidas: true, fuera: false }
  return { lat: null, lon: null, invertidas: false, fuera: true }
}

/** Construye mapa encabezado(normalizado)→índice de columna para una fila dada. */
function mapaEncabezados(ws: ExcelJS.Worksheet, filaHeader: number): Map<string, number> {
  const mapa = new Map<string, number>()
  ws.getRow(filaHeader).eachCell((cell, col) => {
    const nombre = texto(valorCelda(cell))
    if (nombre) mapa.set(nombre.toUpperCase().trim(), col)
  })
  return mapa
}

/** Filas de una hoja como diccionarios {ENCABEZADO: valor} a partir de la fila de datos. */
function filasComoDiccionarios(
  ws: ExcelJS.Worksheet,
  filaHeader: number,
): { filas: Record<string, ValorCelda>[]; numerosFila: number[] } {
  const mapa = mapaEncabezados(ws, filaHeader)
  const filas: Record<string, ValorCelda>[] = []
  const numerosFila: number[] = []
  for (let r = filaHeader + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const dict: Record<string, ValorCelda> = {}
    let tieneContenido = false
    for (const [nombre, col] of mapa) {
      const v = valorCelda(row.getCell(col))
      dict[nombre] = v
      if (v !== null && v !== '') tieneContenido = true
    }
    if (tieneContenido) {
      filas.push(dict)
      numerosFila.push(r)
    }
  }
  return { filas, numerosFila }
}

// --- Instalaciones ---

const TIPOS_IGNORADOS = new Set(['LOCACION', 'LOCACIÓN'])

/** Infiere el campo a partir del prefijo del código cuando CAMPO falta o es inválido. */
function inferirCampoDesdeCodigo(codigo: string): Campo | null {
  const s = codigo.toUpperCase()
  if (/^EF-?BA/.test(s) || /^BA[ -]/.test(s)) return 'BA'
  if (s.startsWith('VLC')) return 'VLC'
  if (/^(VLG|VLD|VLF|LGT)/.test(s)) return 'VLG'
  return null
}

export function importarInstalaciones(filas: Record<string, ValorCelda>[], numerosFila: number[]): {
  instalaciones: Instalacion[]
  alertas: AlertaImport[]
} {
  const alertas: AlertaImport[] = []
  const instalaciones: Instalacion[] = []
  const porClave = new Map<string, Instalacion>()

  filas.forEach((fila, i) => {
    const filaNum = numerosFila[i]
    const codigo = texto(fila['INSTALACION'])
    if (!codigo) return
    const tipo = (texto(fila['TIPO']) ?? '').toUpperCase()
    if (TIPOS_IGNORADOS.has(tipo)) return // LOCACIÓN = área a perforar en tierra, fuera del alcance

    if (tipo && !esTipoInstalacionConocido(tipo)) {
      alertas.push(crearAlerta('tipo_instalacion_desconocido', 'Instalaciones', filaNum, `Tipo desconocido "${tipo}"`, codigo))
    }

    const campoRaw = texto(fila['CAMPO'])
    const campo: Campo | null =
      campoRaw && esCampoValido(campoRaw.toUpperCase())
        ? (campoRaw.toUpperCase() as Campo)
        : inferirCampoDesdeCodigo(codigo)
    if (!campo) {
      alertas.push(crearAlerta('campo_desconocido_instalacion', 'Instalaciones', filaNum, `No se pudo determinar el campo (declarado: "${campoRaw ?? 'vacío'}")`, codigo))
      return
    }

    const lat = numero(fila['LAT'])
    const lon = numero(fila['LON'])
    if (!lat.ok || !lon.ok) {
      alertas.push(crearAlerta('valor_no_numerico', 'Instalaciones', filaNum, 'LAT/LON no numéricas', codigo))
    }
    const coords = normalizarCoordenadas(lat.valor, lon.valor)
    if (lat.valor === null || lon.valor === null) {
      alertas.push(crearAlerta('instalacion_sin_coordenadas', 'Instalaciones', filaNum, 'Instalación sin coordenadas (no se dibuja)', codigo))
    } else if (coords.invertidas) {
      alertas.push(crearAlerta('coordenadas_invertidas', 'Instalaciones', filaNum, `LAT/LON venían invertidas — corregidas (era ${lat.valor}, ${lon.valor})`, codigo))
    } else if (coords.fuera) {
      alertas.push(crearAlerta('coordenadas_fuera_de_rango', 'Instalaciones', filaNum, `Coordenadas fuera del rango del lago (${lat.valor}, ${lon.valor}) — no se dibuja`, codigo))
    }

    const clave = claveNormalizadaInstalacion(codigo)
    if (porClave.has(clave)) {
      alertas.push(crearAlerta('duplicado_instalacion', 'Instalaciones', filaNum, `Duplicada tras normalización (clave "${clave}")`, codigo))
      return
    }
    if (codigo !== codigo.trim() || /\s{2,}/.test(codigo)) {
      alertas.push(crearAlerta('espacios_irregulares', 'Instalaciones', filaNum, 'Espacios al borde o dobles en el código', codigo))
    }

    const inst: Instalacion = {
      id: `inst-${clave}`,
      tipo: tipo || 'OTRO',
      codigo,
      campo,
      lat: coords.lat,
      lon: coords.lon,
      esStub: false,
      activo: true,
    }
    instalaciones.push(inst)
    porClave.set(clave, inst)
  })

  return { instalaciones, alertas }
}

// --- Pozos ---

const METODOS_VALIDOS = new Set<string>(['GL', 'BES', 'NF', 'BM', 'BCP'])

function parsearCoa(v: ValorCelda): { coa: EstatusCoa; alerta: 'coa_vacio' | 'coa_desconocido' | null } {
  if (v === null || String(v).trim() === '') return { coa: 'Indeterminado', alerta: 'coa_vacio' }
  const s = String(v).trim().toLowerCase()
  if (s === 'abierto' || s === '1') return { coa: 'Abierto', alerta: null }
  if (s === 'cerrado' || s === '0') return { coa: 'Cerrado', alerta: null }
  return { coa: 'Indeterminado', alerta: 'coa_desconocido' }
}

interface FilaPozo {
  fila: number
  codigo: string
  lat: number | null
  lon: number | null
  efCodigo: string | null
  mgCodigo: string | null
  completacion: Omit<PozoCompletacion, 'id' | 'pozoId'>
}

/** Puntaje de completitud de una fila para elegir la arena primaria (EF, MG, LAT, LON). */
function completitud(f: FilaPozo): number {
  return (f.efCodigo ? 1 : 0) + (f.mgCodigo ? 1 : 0) + (f.lat !== null ? 1 : 0) + (f.lon !== null ? 1 : 0)
}

const TOLERANCIA_COORDS = 0.0005 // ~50 m

export function importarPozos(
  filas: Record<string, ValorCelda>[],
  numerosFila: number[],
  instalaciones: Instalacion[],
): { pozos: PozoConCompletaciones[]; alertas: AlertaImport[] } {
  const alertas: AlertaImport[] = []
  const mapaInst = new Map(instalaciones.map((i) => [claveNormalizadaInstalacion(i.codigo), i]))
  const registrarInst = (i: Instalacion) => mapaInst.set(claveNormalizadaInstalacion(i.codigo), i)

  // 1. Filas crudas → filas parseadas agrupadas por código de pozo completo (campo+número+reemplazo)
  const gruposPorCodigo = new Map<string, { campo: Campo; numero: number; reemplazo: Pozo['reemplazo']; filas: FilaPozo[] }>()

  filas.forEach((fila, i) => {
    const filaNum = numerosFila[i]
    const codigoCrudo = texto(fila['POZO'])
    if (!codigoCrudo) return
    const campoRaw = (texto(fila['CAMPO']) ?? '').toUpperCase()
    if (!esCampoValido(campoRaw)) {
      alertas.push(crearAlerta('codigo_pozo_invalido', 'Pozos', filaNum, `Campo inválido "${campoRaw}"`, codigoCrudo))
      return
    }
    const parseado = parsearCodigoPozo(codigoCrudo, campoRaw)
    if (!parseado) {
      alertas.push(crearAlerta('codigo_pozo_invalido', 'Pozos', filaNum, `Código no calza con los patrones conocidos`, codigoCrudo))
      return
    }
    if (codigoCrudo !== codigoCrudo.trim() || /\s{2,}/.test(codigoCrudo)) {
      alertas.push(crearAlerta('espacios_irregulares', 'Pozos', filaNum, 'Espacios al borde o dobles en el código', codigoCrudo))
    }

    const lat = numero(fila['LAT'])
    const lon = numero(fila['LON'])
    if (!lat.ok || !lon.ok) {
      alertas.push(crearAlerta('valor_no_numerico', 'Pozos', filaNum, 'LAT/LON no numéricas', codigoCrudo))
    }
    const coords = normalizarCoordenadas(lat.valor, lon.valor)
    if (lat.valor === null || lon.valor === null) {
      alertas.push(crearAlerta('coordenadas_ausentes', 'Pozos', filaNum, 'Fila sin coordenadas', codigoCrudo))
    } else if (coords.invertidas) {
      alertas.push(crearAlerta('coordenadas_invertidas', 'Pozos', filaNum, `LAT/LON venían invertidas — corregidas (era ${lat.valor}, ${lon.valor})`, codigoCrudo))
    } else if (coords.fuera) {
      alertas.push(crearAlerta('coordenadas_fuera_de_rango', 'Pozos', filaNum, `Coordenadas fuera del rango del lago (${lat.valor}, ${lon.valor}) — no se dibuja`, codigoCrudo))
    }

    const pot = numero(fila['POT'])
    const bnpd = numero(fila['BNPD'])
    const cat = numero(fila['CAT'])
    if (!pot.ok) alertas.push(crearAlerta('valor_no_numerico', 'Pozos', filaNum, `POT no numérico: "${fila['POT']}"`, codigoCrudo))
    if (!bnpd.ok) alertas.push(crearAlerta('valor_no_numerico', 'Pozos', filaNum, `BNPD no numérico: "${fila['BNPD']}"`, codigoCrudo))
    if (!cat.ok) alertas.push(crearAlerta('valor_no_numerico', 'Pozos', filaNum, `CAT no numérico: "${fila['CAT']}"`, codigoCrudo))

    let bnpdFecha: Date | null = null
    const fechaRaw = fila['BNPD_FE']
    if (fechaRaw instanceof Date) bnpdFecha = fechaRaw
    else if (fechaRaw !== null && String(fechaRaw).trim() !== '') {
      const d = new Date(String(fechaRaw))
      if (isNaN(d.getTime())) alertas.push(crearAlerta('fecha_invalida', 'Pozos', filaNum, `BNPD_FE inválida: "${fechaRaw}"`, codigoCrudo))
      else bnpdFecha = d
    }

    const metodoRaw = (texto(fila['METODO']) ?? '').toUpperCase()
    let metodo: Metodo | null = null
    if (metodoRaw) {
      if (METODOS_VALIDOS.has(metodoRaw)) metodo = metodoRaw as Metodo
      else alertas.push(crearAlerta('metodo_desconocido', 'Pozos', filaNum, `Método desconocido "${metodoRaw}"`, codigoCrudo))
    }

    const { coa, alerta: alertaCoa } = parsearCoa(fila['COA'])
    if (alertaCoa === 'coa_desconocido') {
      alertas.push(crearAlerta('coa_desconocido', 'Pozos', filaNum, `COA desconocido "${fila['COA']}"`, codigoCrudo))
    }

    const completacion: Omit<PozoCompletacion, 'id' | 'pozoId'> = {
      nbYacimiento: texto(fila['NB_YACIMIENTO']) ?? '',
      coa,
      metodo,
      cat: cat.valor,
      bnpd: bnpd.valor,
      bnpdFecha,
      pot: pot.valor,
      edo: texto(fila['EDO']),
    }

    const clave = `${parseado.campo}|${parseado.numero}|${parseado.reemplazo ?? ''}`
    const grupo = gruposPorCodigo.get(clave) ?? { campo: parseado.campo, numero: parseado.numero, reemplazo: parseado.reemplazo, filas: [] }
    grupo.filas.push({
      fila: filaNum,
      codigo: codigoCrudo,
      lat: coords.lat,
      lon: coords.lon,
      efCodigo: texto(fila['EF']),
      mgCodigo: texto(fila['MG']),
      completacion,
    })
    gruposPorCodigo.set(clave, grupo)
  })

  // 2. Cada grupo → un registro Pozo con sus completaciones deduplicadas por NB_YACIMIENTO
  const pozosPorCodigo = new Map<string, PozoConCompletaciones>()

  for (const [, grupo] of gruposPorCodigo) {
    const filasG = grupo.filas

    // Arena primaria: primera con EF+MG+LAT+LON completos; si no, la más completa; si no, la primera.
    const primaria =
      filasG.find((f) => completitud(f) === 4) ??
      filasG.reduce((mejor, f) => (completitud(f) > completitud(mejor) ? f : mejor))

    // Discrepancias entre arenas (se toma la primaria, se alerta el resto)
    for (const f of filasG) {
      if (f === primaria) continue
      if (
        primaria.lat !== null && primaria.lon !== null && f.lat !== null && f.lon !== null &&
        (Math.abs(f.lat - primaria.lat) > TOLERANCIA_COORDS || Math.abs(f.lon - primaria.lon) > TOLERANCIA_COORDS)
      ) {
        alertas.push(crearAlerta('coordenadas_discrepantes_entre_arenas', 'Pozos', f.fila, `Coordenadas distintas a la arena primaria (fila ${primaria.fila})`, primaria.codigo))
      }
      if (primaria.efCodigo && f.efCodigo && claveNormalizadaEF(f.efCodigo) !== claveNormalizadaEF(primaria.efCodigo)) {
        alertas.push(crearAlerta('ef_discrepante_entre_arenas', 'Pozos', f.fila, `EF "${f.efCodigo}" distinta a la de la arena primaria ("${primaria.efCodigo}")`, primaria.codigo))
      }
    }

    // Cruce EF/MG contra el catálogo; si no existe, se crea stub sin coordenadas
    const cruzar = (codigo: string | null, tipo: 'EF' | 'MG', filaNum: number): Instalacion | null => {
      if (!codigo || esValorNulo(codigo)) return null
      const clave = tipo === 'EF' ? claveNormalizadaEF(codigo) : claveNormalizadaMG(codigo)
      const existente = mapaInst.get(clave)
      if (existente) return existente
      const stub: Instalacion = {
        id: `inst-${clave}`,
        tipo,
        codigo,
        campo: grupo.campo,
        lat: null,
        lon: null,
        esStub: true,
        activo: true,
      }
      registrarInst(stub)
      instalaciones.push(stub)
      alertas.push(crearAlerta(tipo === 'EF' ? 'ef_sin_match' : 'mg_sin_match', 'Pozos', filaNum, `${tipo} "${codigo}" no existe en Instalaciones; se creó stub sin coordenadas`, primaria.codigo))
      return stub
    }

    const efInst = cruzar(primaria.efCodigo, 'EF', primaria.fila)
    const mgInst = cruzar(primaria.mgCodigo, 'MG', primaria.fila)

    // Completaciones deduplicadas por NB_YACIMIENTO exacto
    const compsPorYacimiento = new Map<string, PozoCompletacion>()
    const pozoId = `pozo-${primaria.codigo.replace(/\s+/g, '_')}`
    for (const f of filasG) {
      const yac = f.completacion.nbYacimiento
      if (compsPorYacimiento.has(yac)) {
        alertas.push(crearAlerta('duplicado_completacion', 'Pozos', f.fila, `NB_YACIMIENTO "${yac || '(vacío)'}" repetido para el mismo pozo; se conserva la primera fila`, f.codigo))
        continue
      }
      compsPorYacimiento.set(yac, {
        ...f.completacion,
        id: `${pozoId}#${compsPorYacimiento.size}`,
        pozoId,
      })
    }
    const completaciones = [...compsPorYacimiento.values()]

    if (debeAlertarPorFaltaDeMg(mgInst?.id ?? null, completaciones)) {
      alertas.push(crearAlerta('falta_mg_para_gl', 'Pozos', primaria.fila, 'Pozo con método GL sin MG asignado', primaria.codigo))
    }

    pozosPorCodigo.set(clavePozoFisico({ campo: grupo.campo, numero: grupo.numero }) + '|' + (grupo.reemplazo ?? ''), {
      id: pozoId,
      campo: grupo.campo,
      numero: grupo.numero,
      reemplazo: grupo.reemplazo,
      codigo: primaria.codigo,
      lat: primaria.lat,
      lon: primaria.lon,
      efId: efInst?.id ?? null,
      mgId: mgInst?.id ?? null,
      pcId: null,
      pbesId: null,
      reemplazado: false,
      activo: true,
      completaciones,
    })
  }

  // 3. Marcar reemplazados: dentro de cada (campo, número) gana la letra más alta
  const porPozoFisico = new Map<string, PozoConCompletaciones[]>()
  for (const p of pozosPorCodigo.values()) {
    const clave = clavePozoFisico(p)
    porPozoFisico.set(clave, [...(porPozoFisico.get(clave) ?? []), p])
  }
  for (const grupo of porPozoFisico.values()) {
    if (grupo.length < 2) continue
    const activo = grupo.reduce((a, b) =>
      (a.reemplazo ?? '') >= (b.reemplazo ?? '') ? a : b,
    )
    for (const p of grupo) p.reemplazado = p !== activo
  }

  return { pozos: [...pozosPorCodigo.values()], alertas }
}

// --- Visitas de campo (hojas "GL" y "BES": bitácora de inspecciones) ---

/** Estas dos columnas varían de nombre entre GL y BES; el resto de las claves usadas coinciden ya normalizadas. */
const ALIAS_VISITA: Record<TipoVisita, { estadoInicial: string; estadoFinal: string; horaFin: string }> = {
  GL: { estadoInicial: 'ESTADO POZO INICIAL', estadoFinal: 'ESTADO POZO FINAL', horaFin: 'HORA FIN' },
  BES: { estadoInicial: 'ESTADO INICIAL DEL POZO', estadoFinal: 'ESTADO FINAL DEL POZO', horaFin: 'HORA FINAL' },
}

function normalizarCodigoPozo(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}

/** Hora como Date (Excel guarda horas puras con fecha base 1899-12-30) o texto libre ("S/I"). */
function horaTexto(v: ValorCelda): string | null {
  if (v === null) return null
  if (v instanceof Date) {
    const hh = String(v.getUTCHours()).padStart(2, '0')
    const mm = String(v.getUTCMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  const s = String(v).trim()
  return s === '' ? null : s
}

function valorPlano(v: ValorCelda): string | number | boolean {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number' || typeof v === 'boolean') return v
  return String(v)
}

/**
 * Resuelve el pozo real referenciado por una visita: primero por código
 * exacto (normalizado), y si no calza, por pozo físico (campo+número) tomando
 * el vigente — una visita vieja puede referenciar una letra de reemplazo que
 * ya no es la activa, y sigue queriendo apuntar al mismo pozo físico.
 */
function resolverPozoDeVisita(
  pozoTexto: string,
  campo: Campo | null,
  pozosPorCodigoExacto: ReadonlyMap<string, PozoConCompletaciones>,
  pozosPorFisicoVigente: ReadonlyMap<string, PozoConCompletaciones>,
): string | null {
  const exacto = pozosPorCodigoExacto.get(normalizarCodigoPozo(pozoTexto))
  if (exacto) return exacto.id
  if (!campo) return null
  const parsed = parsearCodigoPozo(pozoTexto, campo)
  if (!parsed) return null
  return pozosPorFisicoVigente.get(clavePozoFisico(parsed))?.id ?? null
}

/** Columnas ya extraídas a campos propios de VisitaCampo: no van a datosExtra. */
function clavesCoreVisita(tipo: TipoVisita): Set<string> {
  const alias = ALIAS_VISITA[tipo]
  return new Set(['FECHA', 'POZO', 'CUADRILLA', 'TIPO DE ACTIVIDAD', 'HORA INICIO', 'COMENTARIOS OPERACIONALES', alias.estadoInicial, alias.estadoFinal, alias.horaFin])
}

function importarVisitas(
  filas: Record<string, ValorCelda>[],
  numerosFila: number[],
  tipo: TipoVisita,
  hoja: string,
  pozosPorCodigoExacto: ReadonlyMap<string, PozoConCompletaciones>,
  pozosPorFisicoVigente: ReadonlyMap<string, PozoConCompletaciones>,
): { visitas: VisitaCampo[]; alertas: AlertaImport[] } {
  const alertas: AlertaImport[] = []
  const visitas: VisitaCampo[] = []
  const vistas = new Set<string>()
  const alias = ALIAS_VISITA[tipo]
  const core = clavesCoreVisita(tipo)

  filas.forEach((fila, i) => {
    const filaNum = numerosFila[i]
    const pozoTexto = texto(fila['POZO'])
    if (!pozoTexto) return // fila sin pozo: arrastre de fórmula o fila vacía, no es una visita real

    const fechaRaw = fila['FECHA']
    let fecha: Date | null = null
    if (fechaRaw instanceof Date) fecha = fechaRaw
    else if (fechaRaw !== null && String(fechaRaw).trim() !== '') {
      const d = new Date(String(fechaRaw))
      if (!isNaN(d.getTime())) fecha = d
    }
    if (!fecha) {
      alertas.push(crearAlerta('visita_sin_fecha', hoja, filaNum, 'Visita sin fecha válida — no se importó', pozoTexto))
      return
    }

    const cuadrilla = texto(fila['CUADRILLA']) ?? ''
    const clave = claveVisita({ tipo, fecha, pozoTexto, cuadrilla })
    if (vistas.has(clave)) {
      alertas.push(crearAlerta('duplicado_visita', hoja, filaNum, 'Visita duplicada tras normalización (misma fecha/pozo/cuadrilla); se conserva la primera fila', pozoTexto))
      return
    }
    vistas.add(clave)

    const campo = inferirCampoDesdeCodigo(pozoTexto)
    const pozoId = resolverPozoDeVisita(pozoTexto, campo, pozosPorCodigoExacto, pozosPorFisicoVigente)
    if (!pozoId) {
      alertas.push(crearAlerta('visita_pozo_sin_match', hoja, filaNum, `Pozo "${pozoTexto}" no calza con ningún pozo del universo — visita guardada sin vincular`, pozoTexto))
    }

    const datosExtra: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(fila)) {
      if (core.has(k) || v === null || v === '') continue
      datosExtra[k] = valorPlano(v)
    }

    visitas.push({
      id: `visita-${clave}`,
      tipo,
      fecha,
      pozoTexto,
      pozoId,
      cuadrilla,
      campo,
      tipoActividad: texto(fila['TIPO DE ACTIVIDAD']),
      estadoInicial: texto(fila[alias.estadoInicial]),
      estadoFinal: texto(fila[alias.estadoFinal]),
      comentarios: texto(fila['COMENTARIOS OPERACIONALES']),
      horaInicio: horaTexto(fila['HORA INICIO']),
      horaFin: horaTexto(fila[alias.horaFin]),
      datosExtra,
    })
  })

  return { visitas, alertas }
}

// --- Orquestador .xlsx ---

export async function importarExcel(buffer: ArrayBuffer): Promise<ResultadoImport> {
  const { default: ExcelJSRuntime } = await import('exceljs')
  const wb = new ExcelJSRuntime.Workbook()
  await wb.xlsx.load(buffer)

  const wsInst = wb.getWorksheet('Instalaciones')
  const wsPozos = wb.getWorksheet('Pozos')
  if (!wsInst || !wsPozos) throw new Error('El archivo debe tener las hojas "Pozos" e "Instalaciones"')

  const inst = filasComoDiccionarios(wsInst, 1) // encabezado en fila 1
  const poz = filasComoDiccionarios(wsPozos, 2) // encabezado en fila 2 (fila 1 ignorada)

  const { instalaciones, alertas: alertasInst } = importarInstalaciones(inst.filas, inst.numerosFila)
  const { pozos, alertas: alertasPozos } = importarPozos(poz.filas, poz.numerosFila, instalaciones)

  // Hojas "GL"/"BES": bitácora de visitas — opcionales, no todo archivo las trae.
  const pozosPorCodigoExacto = new Map(pozos.map((p) => [normalizarCodigoPozo(p.codigo), p] as const))
  const pozosPorFisicoVigente = new Map(
    pozos.filter((p) => !p.reemplazado).map((p) => [clavePozoFisico(p), p] as const),
  )
  const visitas: VisitaCampo[] = []
  const alertasVisitas: AlertaImport[] = []
  for (const tipo of ['GL', 'BES'] as const) {
    const ws = wb.getWorksheet(tipo)
    if (!ws) continue
    const { filas, numerosFila } = filasComoDiccionarios(ws, 1) // encabezado en fila 1
    const r = importarVisitas(filas, numerosFila, tipo, tipo, pozosPorCodigoExacto, pozosPorFisicoVigente)
    visitas.push(...r.visitas)
    alertasVisitas.push(...r.alertas)
  }

  return {
    pozos,
    instalaciones,
    visitas,
    indicadores: calcularIndicadores(visitas),
    alertas: [...alertasInst, ...alertasPozos, ...alertasVisitas],
  }
}
