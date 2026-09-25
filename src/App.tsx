import { useEffect } from 'react'
import { MapaBase } from './map/MapaBase'
import { PanelDetalle } from './ui/PanelDetalle'
import { PanelFiltros } from './ui/PanelFiltros'
import { BarraHerramientas } from './ui/BarraHerramientas'
import { PanelAsignacion } from './ui/PanelAsignacion'
import { PanelPlan } from './ui/PanelPlan'
import { Login } from './ui/Login'
import { cargarExcelDev } from './state/datosStore'
import { useAuthStore } from './state/authStore'
import { useAsignacionesStore } from './state/asignacionesStore'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './App.css'

function App() {
  const sesion = useAuthStore((s) => s.sesion)
  const listo = useAuthStore((s) => s.listo)

  useEffect(() => {
    void useAuthStore.getState().inicializar()
    void cargarExcelDev()
  }, [])

  // La data del plan existe solo dentro de una sesión autenticada (RLS).
  useEffect(() => {
    const asig = useAsignacionesStore.getState()
    if (sesion) void asig.inicializar()
    else asig.reiniciar()
  }, [sesion])

  if (!listo) return <div className="app-splash">Cargando…</div>
  if (!sesion) return <Login />

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <MapaBase />
        <BarraHerramientas />
        <PanelFiltros />
        <PanelDetalle />
        <PanelAsignacion />
        <PanelPlan />
      </div>
    </ErrorBoundary>
  )
}

export default App
