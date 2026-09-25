import { useState } from 'react'
import { useAuthStore } from '@/state/authStore'
import './Login.css'

/** Pantalla de acceso: el plan y las cuadrillas exigen usuario autenticado (RLS). */
export function Login() {
  const { entrar, entrando, errorAuth } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim() && password) void entrar(email.trim(), password)
  }

  return (
    <div className="login-fondo">
      <form className="login-card" onSubmit={enviar}>
        <div className="login-titulo">Fiel Service Planner</div>
        <div className="login-subtitulo">Lago · Plan de operaciones</div>

        <label className="login-campo">
          Correo
          <input
            type="email"
            value={email}
            autoComplete="username"
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
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

        <button type="submit" className="login-boton" disabled={entrando || !email.trim() || !password}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
