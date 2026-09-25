import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importarExcel } from './importadorExcel'

/**
 * Prueba de humo contra el Excel real (gitignored). Se omite si el archivo no
 * está presente (CI, clones sin datos). Valida las invariantes observadas en la
 * foto de datos de septiembre 2026: ~1398 pozos, ~168 instalaciones (210 menos
 * las 42 LOCACIÓN de tierra), 6 códigos sin match convertidos en stubs.
 */

const RUTA = resolve(__dirname, '../../Excel Data.xlsx')
const hayArchivo = existsSync(RUTA)

describe.skipIf(!hayArchivo)('importadorExcel con el archivo real', () => {
  it('importa el universo de pozos e instalaciones sin perder filas', async () => {
    const buffer = readFileSync(RUTA)
    const { pozos, instalaciones, alertas } = await importarExcel(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    )

    // Volumen aproximado esperado
    expect(pozos.length).toBeGreaterThan(1300)
    expect(instalaciones.length).toBeGreaterThan(160)
    expect(instalaciones.length).toBeLessThan(230)

    // Todo pozo tiene al menos una completación
    expect(pozos.every((p) => p.completaciones.length >= 1)).toBe(true)

    // Los códigos EF/MG sin match del catálogo quedaron como stubs
    const stubs = instalaciones.filter((i) => i.esStub)
    const codigosStub = stubs.map((s) => s.codigo)
    for (const esperado of ['BA-6', 'BA 1-20', 'BA 250', 'BA 419', 'BA 502', 'BA 541']) {
      expect(codigosStub).toContain(esperado)
    }
    // Los stubs no tienen coordenadas
    expect(stubs.every((s) => s.lat === null)).toBe(true)

    // NOLINEA no genera stub
    expect(codigosStub.some((c) => c.includes('NOLINEA'))).toBe(false)

    // Se generaron alertas pero ninguna de código inválido
    expect(alertas.length).toBeGreaterThan(0)
    expect(alertas.filter((a) => a.tipo === 'codigo_pozo_invalido')).toHaveLength(0)

    // Ningún pozo reemplazado aparece como activo a la vez que su reemplazo
    const porGrupo = new Map<string, number>()
    for (const p of pozos.filter((x) => !x.reemplazado)) {
      const k = `${p.campo}|${p.numero}`
      porGrupo.set(k, (porGrupo.get(k) ?? 0) + 1)
    }
    expect([...porGrupo.values()].every((n) => n === 1)).toBe(true)
  })
})
