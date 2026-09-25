import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Última línea de defensa: un error de render nunca debe dejar la pantalla
 * negra sin diagnóstico. Muestra el mensaje y permite recargar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[ErrorBoundary]', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#111827' }}>
        <h2 style={{ marginTop: 0 }}>Algo falló en la aplicación</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c', fontSize: 12 }}>
          {this.state.error.stack ?? String(this.state.error)}
        </pre>
        <button type="button" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </div>
    )
  }
}
