import { useState } from 'react'
import { useAuthStore } from '@/state/authStore'
import './Login.css'

/** Pantalla de acceso: el plan y las cuadrillas exigen usuario autenticado (RLS). */
export function Login() {
  const { entrar, entrando, errorAuth } = useAuthStore()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    if (usuario.trim() && password) void entrar(usuario.trim(), password)
  }

  return (
    <div className="login-fondo">
      <form className="login-card" onSubmit={enviar}>
        <div className="login-titulo">Fiel Service Planner</div>
        <div className="login-subtitulo">Lago · Plan de operaciones</div>

        <label className="login-campo">
          Usuario
          <input
            type="text"
            value={usuario}
            autoComplete="username"
            autoFocus
            onChange={(e) => setUsuario(e.target.value)}
            required
          />
        </label>
        <label className="login-campo">
          Contraseña
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {errorAuth && <div className="login-error">{errorAuth}</div>}

        <button type="submit" className="login-boton" disabled={entrando || !usuario.trim() || !password}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
