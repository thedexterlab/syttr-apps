import { useMemo, useState } from 'react'
import brandLogo from '../../assets/app-logo.png'
import { loginAdmin } from '../api'
import {
  ADMIN_SESSION_STORAGE_KEY,
  ADMIN_TOKEN_STORAGE_KEY,
  ADMIN_USER_STORAGE_KEY,
} from '../storage'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [status, setStatus] = useState({ type: null, message: '' })
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [userInfo, setUserInfo] = useState({ name: '', email: '' })

  const handleSubmit = async (event) => {
    event.preventDefault()
    setStatus({ type: null, message: '' })
    setLoading(true)

    try {
      const data = await loginAdmin({ email, password, remember })

      const userName = data?.admin?.name || formattedName
      const userEmail = data?.admin?.email || email

      localStorage.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify({
          token: data?.token || null,
          admin: data?.admin || null,
        }),
      )
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data?.token || '')

      localStorage.setItem(
        ADMIN_USER_STORAGE_KEY,
        JSON.stringify({
          name: userName,
          email: userEmail,
        }),
      )

      setUserInfo({ name: userName, email: userEmail })
      setStatus({
        type: 'success',
        message: 'Signed in.',
      })
      setShowModal(true)
    } catch (error) {
      const message =
        error?.status === 401
          ? 'Invalid credentials. Please try again.'
          : error?.message || 'Unable to sign in. Please try again.'
      setStatus({
        type: 'error',
        message,
      })
    } finally {
      setLoading(false)
    }
  }

  const formattedName = useMemo(() => {
    if (!email) return 'Welcome'
    const base = email.split('@')[0] || ''
    const words = base.split(/[._-]/).filter(Boolean)
    if (!words.length) return 'Welcome'
    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }, [email])

  const handleConfirm = () => {
    const payload = JSON.stringify({ name: formattedName, email })
    localStorage.setItem(ADMIN_USER_STORAGE_KEY, payload)
    document.body.classList.add('page-fade')
    setTimeout(() => {
      window.location.href = '/dashboard'
    }, 300)
  }

  return (
    <div className="app-shell">
      <div className="glow glow-1" />
      <div className="glow glow-2" />

      <div className="auth-card">
        <section className="hero-copy">
          <div className="brand">
            <img className="brand-mark" src={brandLogo} alt="SYTTR logo" />
            <div>
              <p className="eyebrow">Syttr Admin</p>
              <h1>Sign in to the console</h1>
            </div>
          </div>

          <p className="lead">
            Stay on top of caregivers, bookings, and operations from one command center. Continue where you left off.
          </p>

          <div className="pill-group">
            <span className="pill">Secure by default</span>
            <span className="pill">Live status</span>
            <span className="pill">Team-ready</span>
          </div>

          <div className="meta-card">
            <p className="meta-title">Need access?</p>
            <p className="meta-body">
              Ask your workspace admin to invite you. We&apos;ll send a secure sign-in link to your email.
            </p>
          </div>
        </section>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@syttr.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <div className="field-header">
              <label htmlFor="password">Password</label>
              <button className="ghost-button" type="button">
                Forgot?
              </button>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="********"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <label className="remember">
            <input
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
              name="remember"
            />
            <span>Keep me signed in on this device</span>
          </label>

          {status.message ? (
            <div
              className={`status ${status.type === 'error' ? 'error' : 'success'}`}
              role="status"
              aria-live="polite"
            >
              {status.message}
            </div>
          ) : null}

          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="subtext">
            By continuing you agree to the admin terms and security guidelines.
          </p>
        </form>
      </div>

      {showModal ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 className="modal-title">Welcome back!</h2>
            <p className="modal-body">
              <strong>{userInfo.name || formattedName}</strong>
            </p>
            <p className="modal-body muted">{userInfo.email || email}</p>
            <button className="primary modal-btn" type="button" onClick={handleConfirm}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Login
