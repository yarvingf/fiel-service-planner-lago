import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/**
 * Hace arrastrable un panel flotante y persiste su posición en localStorage.
 *
 * `alArrastrar` va en la zona de agarre (header/grip): ignora clics que
 * empiezan sobre botones, inputs, selects o enlaces para que los controles
 * del header sigan funcionando. La posición se limita a la ventana con un
 * margen de 4px para que el panel nunca quede fuera de pantalla.
 */
export function useArrastrable<T extends HTMLElement = HTMLElement>(storageKey: string): {
  ref: RefObject<T | null>
  pos: { x: number; y: number } | null
  alArrastrar: (e: ReactPointerEvent) => void
} {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
        if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
      }
    } catch {
      /* posición guardada inválida — se usa la por defecto */
    }
    return null
  })
  const ref = useRef<T | null>(null)

  const alArrastrar = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, a, textarea')) return
    const el = ref.current
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const dx = e.clientX - rect.left
    const dy = e.clientY - rect.top
    const mover = (ev: PointerEvent) => {
      setPos({
        x: Math.min(Math.max(ev.clientX - dx, 4), Math.max(4, window.innerWidth - rect.width - 4)),
        y: Math.min(Math.max(ev.clientY - dy, 4), Math.max(4, window.innerHeight - rect.height - 4)),
      })
    }
    const soltar = () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      const r = ref.current?.getBoundingClientRect()
      if (r) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }))
        } catch {
          /* localStorage lleno o bloqueado — no persistir */
        }
      }
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }

  return { ref, pos, alArrastrar }
}
