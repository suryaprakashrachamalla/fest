import { FormEvent, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { apiConfigured, createAccount, getStoredUser, signIn } from "../api"

function PortalForm() {
  const { pathname, state } = useLocation()
  const navigate = useNavigate()
  const isSignup = pathname === "/signup"
  const [name, setName] = useState("")
  const [email, setEmail] = useState((state as { email?: string } | null)?.email ?? "")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(false)
  const justSignedUp = !isSignup && (state as { created?: boolean } | null)?.created === true
  const user = getStoredUser()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")
    if (isSignup && name.trim().length < 2) return setError("Enter your full name.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.")
    if (isSignup && password.length < 10) return setError("Use a password with at least 10 characters.")
    if (!password) return setError("Enter your password.")
    setBusy(true)
    try {
      if (isSignup) {
        await createAccount(name.trim(), email.trim(), password)
        setPassword("")
        setCreated(true)
      } else {
        await signIn(email.trim(), password)
        navigate("/dashboard")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="portal-page">
      <Link className="portal-brand" to="/">
        SHOURYA&apos;26
      </Link>
      <div className="portal-art">
        <span>MAKE</span>
        <span>IT</span>
        <span>LOUD.</span>
      </div>
      <section className="portal-form-wrap">
        <p className="eyebrow">{isSignup ? "Sign up" : "Log in"}</p>
        <h1>{isSignup ? "Be first in line." : "Enter the arena."}</h1>
        <p>
          {isSignup
            ? "Create your account to register for events. After signing up, log in to open your dashboard."
            : "Log in to open your dashboard and track your registrations and payment status."}
        </p>

        {!apiConfigured ? (
          <div className="modal-error-banner portal-notice">Online registration isn&apos;t connected yet. Please check back soon.</div>
        ) : created ? (
          <>
            <div className="success-message">
              <span>✓</span>
              Account created. Please log in to continue.
            </div>
            <Link className="portal-cta" to="/login" state={{ email: email.trim(), created: true }}>
              Log in <span>↗</span>
            </Link>
          </>
        ) : !isSignup && user ? (
          <>
            <div className="success-message">
              <span>✓</span>
              You&apos;re logged in as {user.email}.
            </div>
            <Link className="portal-cta" to="/dashboard">
              Open my dashboard <span>↗</span>
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {justSignedUp && <div className="success-message portal-notice">Account created. Log in with your new password.</div>}
            {error && <div className="modal-error-banner portal-notice">{error}</div>}
            {isSignup && (
              <>
                <label htmlFor="portal-name">Full name</label>
                <input id="portal-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
              </>
            )}
            <label htmlFor="portal-email">Email address</label>
            <input
              id="portal-email"
              type="email"
              placeholder="you@campus.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <label htmlFor="portal-password">{isSignup ? "Password (min 10 characters)" : "Password"}</label>
            <input
              id="portal-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
            <button type="submit" disabled={busy}>
              {busy ? "Please wait…" : isSignup ? "Create account" : "Log in"} <span>↗</span>
            </button>
            <p className="portal-switch">
              {isSignup ? "Already have an account? " : "New here? "}
              <Link to={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Sign up"}</Link>
            </p>
          </form>
        )}

        <Link className="back-link" to="/">
          ← Back to the festival
        </Link>
      </section>
    </main>
  )
}

// Keyed by path so switching between log in and sign up starts with a fresh form.
export default function PortalPage() {
  const { pathname } = useLocation()
  return <PortalForm key={pathname} />
}
