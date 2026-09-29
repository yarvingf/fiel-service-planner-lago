import { useEffect } from 'react'
import { MapaBase } from './map/MapaBase'
import { PanelDetalle } from './ui/PanelDetalle'
import { PanelFiltros } from './ui/PanelFiltros'
import { BarraHerramientas } from './ui/BarraHerramientas'
import { PanelAsignacion } from './ui/PanelAsignacion'
import { PanelPlan } from './ui/PanelPlan'
import { Login } from './ui/Login'
import { ModalSincronizacion } from './ui/ModalSincronizacion'
import { cargarExcelDev, useDatosStore } from './state/datosStore'
import { useAuthStore } from './state/authStore'
import { useAsignacionesStore } from './state/asignacionesStore'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './App.css'

function App() {
  const sesion = useAuthStore((s) => s.sesion)
  const listo = useAuthStore((s) => s.listo)

  useEffect(() => {
    void useAuthStore.getState().inicializar()
  }, [])

  // El universo pozos/instalaciones se carga una vez por sesión desde
  // Supabase — persiste entre PCs/usuarios y evita depender de resubir el
  // Excel cada vez que se abre la app. En dev sin variables VITE_SUPABASE_*
  // configuradas cae al Excel local (public/, gitignored) para poder iterar.
  useEffect(() => {
    if (!sesion) return
    if (useDatosStore.getState().pozos.length > 0) return
    void useDatosStore.getState().cargarDesdeSupabase().then(() => {
      if (useDatosStore.getState().pozos.length === 0) void cargarExcelDev()
    })
  }, [sesion])

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
        <aside className="app-rail">
          <PanelFiltros />
        </aside>
        <div className="app-mapa">
          <MapaBase />
          <BarraHerramientas />
          <PanelDetalle />
          <PanelAsignacion />
          <PanelPlan />
          <ModalSincronizacion />
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default App
