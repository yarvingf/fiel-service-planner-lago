import { describe, expect, it } from 'vitest'
import { calcularIndicadores, defaultsChecklistAsignacion, pozosConIndicador, type IndicadorPozo } from './indicadores'
import type { VisitaCampo } from './visitaCampo'

function visita(parcial: Partial<VisitaCampo>): VisitaCampo {
  return {
    id: 'v1',
    tipo: 'GL',
    fecha: new Date('2026-10-05T00:00:00Z'),
    pozoTexto: 'BA-2455',
    pozoId: 'pozo-BA_2455',
    cuadrilla: 'CT #1',
    campo: 'BA',
    tipoActividad: null,
    estadoInicial: null,
    estadoFinal: null,
    comentarios: null,
    horaInicio: null,
    horaFin: null,
    datosExtra: {},
    ...parcial,
  }
}

const del = (inds: IndicadorPozo[], ind: IndicadorPozo['indicador']) =>
  inds.find((i) => i.indicador === ind)

describe('calcularIndicadores', () => {
  it('GL: registro manométrico cuando la columna dice "Si" (con saltos de línea en el encabezado)', () => {
    const v = visita({
      datosExtra: { 'POZOS CON ESTUDIOS\nMANOMETRICOS (SI / NO)': 'Si' },
    })
    const inds = calcularIndicadores([v])
    expect(del(inds, 'registro_manometrico')).toMatchObject({ valor: 1, fecha: '2026-10-05' })
  })

  it('GL: no emite registro manométrico con "No" o vacío', () => {
    for (const valor of ['No', 'NO', '', 'S/I']) {
      const v = visita({ datosExtra: { 'POZOS CON ESTUDIOS MANOMETRICOS (SI / NO)': valor } })
      expect(del(calcularIndicadores([v]), 'registro_manometrico')).toBeUndefined()
    }
  })

  it('GL: ajuste de gas con valance = encontrado − ajustado', () => {
    const v = visita({
      datosExtra: {
        'AJUSTO GAS\n(SI / NO)': 'SI',
        'QG INY ENCONTRADO': 520,
        'QG INY AJUSTADO': 480,
      },
    })
    const inds = calcularIndicadores([v])
    expect(del(inds, 'ajuste_gl')).toMatchObject({ valor: 40 })
  })

  it('GL: ajuste marcado "Si" sin caudales → valor null', () => {
    const v = visita({ datosExtra: { 'AJUSTO GAS (SI / NO)': 'Sí' } })
    expect(del(calcularIndicadores([v]), 'ajuste_gl')).toMatchObject({ valor: null })
  })

  it('BES: niveles cuando NIVEL = "Si"', () => {
    const v = visita({ tipo: 'BES', datosExtra: { NIVEL: 'Si' } })
    expect(del(calcularIndicadores([v]), 'niveles')).toMatchObject({ valor: 1 })
  })

  it('chequeo físico existe en GL y BES con encabezados distintos', () => {
    const gl = visita({ tipo: 'GL', datosExtra: { 'CHEQUEO\nFISICO\n(SI /NO)': 'SI' } })
    const bes = visita({ id: 'v2', tipo: 'BES', datosExtra: { 'CHEQUEO FISICO': 'si' } })
    expect(del(calcularIndicadores([gl]), 'chequeo_fisico')).toBeDefined()
    expect(del(calcularIndicadores([bes]), 'chequeo_fisico')).toBeDefined()
  })

  it('visita a pozo: califica si CHP o THP tienen lectura real', () => {
    const conChp = visita({ datosExtra: { 'CHP\n(PSIG)': 150, 'THP\n(PSIG)': 'S/I' } })
    const conThp = visita({ datosExtra: { 'CHP\n(PSIG)': 'S/I', 'THP\n(PSIG)': '200' } })
    expect(del(calcularIndicadores([conChp]), 'visita_pozo')).toMatchObject({ valor: 1 })
    expect(del(calcularIndicadores([conThp]), 'visita_pozo')).toMatchObject({ valor: 1 })
  })

  it('visita a pozo: ambos en S/I, vacíos o ausentes → no se visitó', () => {
    const variantes: Record<string, string | number | boolean>[] = [
      { 'CHP\n(PSIG)': 'S/I', 'THP\n(PSIG)': 'S/I' },
      { 'CHP\n(PSIG)': '', 'THP\n(PSIG)': ' ' },
      {},
    ]
    for (const datosExtra of variantes) {
      const v = visita({ datosExtra })
      expect(del(calcularIndicadores([v]), 'visita_pozo')).toBeUndefined()
    }
  })

  it('BES: visita a pozo usa las columnas sin sufijo (PSIG)', () => {
    const v = visita({ tipo: 'BES', datosExtra: { CHP: 'S/I', THP: 80 } })
    expect(del(calcularIndicadores([v]), 'visita_pozo')).toBeDefined()
  })

  it('una visita puede generar varios indicadores a la vez', () => {
    const v = visita({
      datosExtra: {
        'CHP\n(PSIG)': 100,
        'POZOS CON ESTUDIOS MANOMETRICOS (SI / NO)': 'SI',
        'CHEQUEO FISICO (SI /NO)': 'Si',
      },
    })
    const inds = calcularIndicadores([v])
    expect(inds.map((i) => i.indicador).sort()).toEqual(
      ['chequeo_fisico', 'registro_manometrico', 'visita_pozo'].sort(),
    )
  })

  it('ids deterministas e idempotentes: mismo input → mismos ids', () => {
    const v = visita({ datosExtra: { 'CHP\n(PSIG)': 100 } })
    const a = calcularIndicadores([v])
    const b = calcularIndicadores([v])
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
    expect(a[0].id).toBe('v1|visita_pozo')
  })

  it('visitas sin pozo resuelto (pozoId null) no generan indicadores', () => {
    const v = visita({ pozoId: null, datosExtra: { 'CHP\n(PSIG)': 100 } })
    expect(calcularIndicadores([v])).toEqual([])
  })

  it('BES nunca emite indicadores GL y viceversa', () => {
    const bes = visita({ tipo: 'BES', datosExtra: { 'AJUSTO GAS (SI / NO)': 'SI', NIVEL: 'Si' } })
    const inds = calcularIndicadores([bes])
    expect(del(inds, 'ajuste_gl')).toBeUndefined()
    expect(del(inds, 'niveles')).toBeDefined()
    expect(del(inds, 'registro_manometrico')).toBeUndefined()
  })
})

describe('pozosConIndicador', () => {
  const ind: IndicadorPozo = {
    id: 'x|registro_manometrico',
    pozoId: 'pozo-1',
    fecha: '2026-10-05',
    indicador: 'registro_manometrico',
    valor: 1,
    visitaId: 'x',
  }
  // "hoy" fijo para los tests: octubre 2026.
  const hoy = new Date('2026-10-20T12:00:00Z')

  it('sin indicadores elegidos → null (sin filtro)', () => {
    expect(pozosConIndicador([ind], [], 'todos', { hoy })).toBeNull()
  })

  it('filtra por pozo dentro del periodo', () => {
    const set = pozosConIndicador([ind], ['registro_manometrico'], 'todos', { hoy })
    expect(set?.has('pozo-1')).toBe(true)
  })

  it('periodo "mes" excluye indicadores de meses anteriores', () => {
    const viejo = { ...ind, fecha: '2026-09-15' }
    expect(pozosConIndicador([viejo], ['registro_manometrico'], 'mes', { hoy })?.size).toBe(0)
    expect(pozosConIndicador([ind], ['registro_manometrico'], 'mes', { hoy })?.size).toBe(1)
  })

  it('periodo "anio" excluye años anteriores', () => {
    const viejo = { ...ind, fecha: '2025-12-31' }
    expect(pozosConIndicador([viejo], ['registro_manometrico'], 'anio', { hoy })?.size).toBe(0)
    expect(pozosConIndicador([ind], ['registro_manometrico'], 'anio', { hoy })?.size).toBe(1)
  })

  it('periodo "ultimos30" acepta solo fechas de los últimos 30 días', () => {
    const hace60 = { ...ind, fecha: '2026-08-20' }
    const hace10 = { ...ind, fecha: '2026-10-11' }
    expect(pozosConIndicador([hace60], ['registro_manometrico'], 'ultimos30', { hoy })?.size).toBe(0)
    expect(pozosConIndicador([hace10], ['registro_manometrico'], 'ultimos30', { hoy })?.size).toBe(1)
  })

  it('periodo "ultimos3m" acepta solo fechas de los últimos 3 meses', () => {
    const hace4m = { ...ind, fecha: '2026-06-01' }
    const hace2m = { ...ind, fecha: '2026-08-15' }
    expect(pozosConIndicador([hace4m], ['registro_manometrico'], 'ultimos3m', { hoy })?.size).toBe(0)
    expect(pozosConIndicador([hace2m], ['registro_manometrico'], 'ultimos3m', { hoy })?.size).toBe(1)
  })

  it('periodo "desde" usa la fecha elegida como cota inferior', () => {
    const viejo = { ...ind, fecha: '2026-05-10' }
    const todos = pozosConIndicador([viejo], ['registro_manometrico'], 'desde', { hoy })
    expect(todos?.size).toBe(1) // sin fecha → sin cota
    const desdeJunio = pozosConIndicador([viejo], ['registro_manometrico'], 'desde', { hoy, desde: '2026-06-01' })
    expect(desdeJunio?.size).toBe(0)
    const desdeAbril = pozosConIndicador([viejo], ['registro_manometrico'], 'desde', { hoy, desde: '2026-04-01' })
    expect(desdeAbril?.size).toBe(1)
  })

  it('varios indicadores = OR: califica con cualquiera', () => {
    const otro: IndicadorPozo = { ...ind, id: 'y|niveles', pozoId: 'pozo-2', indicador: 'niveles' }
    const set = pozosConIndicador([ind, otro], ['registro_manometrico', 'niveles'], 'todos', { hoy })
    expect(set?.has('pozo-1')).toBe(true)
    expect(set?.has('pozo-2')).toBe(true)
    // Indicador no elegido no califica.
    expect(pozosConIndicador([otro], ['registro_manometrico'], 'todos', { hoy })?.size).toBe(0)
  })
})

describe('defaultsChecklistAsignacion', () => {
  const hoy = new Date('2026-10-20T12:00:00Z')
  const reciente = (indicador: IndicadorPozo['indicador']): IndicadorPozo => ({
    id: `x|${indicador}`,
    pozoId: 'pozo-1',
    fecha: '2026-10-10',
    indicador,
    valor: 1,
    visitaId: 'x',
  })

  it('sin indicadores recientes → manómetro y nivel en Sí, ajuste en No', () => {
    expect(defaultsChecklistAsignacion([], 'pozo-1', hoy)).toEqual({
      validarAjuste: false,
      requiereManometro: true,
      requiereNivel: true,
    })
  })

  it('registro manométrico ≤30 días → requiereManometro en No', () => {
    const d = defaultsChecklistAsignacion([reciente('registro_manometrico')], 'pozo-1', hoy)
    expect(d.requiereManometro).toBe(false)
    expect(d.requiereNivel).toBe(true) // nivel sigue pendiente
  })

  it('nivel ≤30 días → requiereNivel en No', () => {
    const d = defaultsChecklistAsignacion([reciente('niveles')], 'pozo-1', hoy)
    expect(d.requiereNivel).toBe(false)
    expect(d.requiereManometro).toBe(true)
  })

  it('indicador de más de 30 días no cuenta como reciente', () => {
    const viejo = { ...reciente('registro_manometrico'), fecha: '2026-08-01' }
    expect(defaultsChecklistAsignacion([viejo], 'pozo-1', hoy).requiereManometro).toBe(true)
  })

  it('indicadores de OTRO pozo no afectan', () => {
    const otro = { ...reciente('registro_manometrico'), pozoId: 'pozo-2' }
    expect(defaultsChecklistAsignacion([otro], 'pozo-1', hoy).requiereManometro).toBe(true)
  })

  it('validarAjuste siempre en No por defecto, aun con ajuste reciente', () => {
    const d = defaultsChecklistAsignacion([reciente('ajuste_gl')], 'pozo-1', hoy)
    expect(d.validarAjuste).toBe(false)
  })
})
