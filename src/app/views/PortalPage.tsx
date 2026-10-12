import { FormEvent, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { apiConfigured, createAccount, getStoredUser, signIn } from "../api"
import { ADMIN_PATH } from "../adminPath"

function PortalForm() {
  const { pathname, state } = useLocation()
  const navigate = useNavigate()
  const isSignup = pathname === "/signup"
  const [name, setName] = useState("")
  const [email, setEmail] = useState((state as { email?: string } | null)?.email ?? "")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  // Per-field problems, shown under each input.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name" | "email" | "password", string>>>({})
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(false)
  const justSignedUp = !isSignup && (state as { created?: boolean } | null)?.created === true
  const user = getStoredUser()

  // Editing a field clears its message; the rest stay until the next submit.
  function clearFieldError(field: keyof typeof fieldErrors) {
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")
    const problems: typeof fieldErrors = {}
    if (isSignup && name.trim().length < 2) problems.name = "Enter your full name."
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) problems.email = "Enter a valid email address."
    if (!password) problems.password = "Enter your password."
    else if (isSignup && password.length < 10) problems.password = "Use at least 10 characters."
    setFieldErrors(problems)
    if (Object.keys(problems).length) return
    setBusy(true)
    try {
      if (isSignup) {
        await createAccount(name.trim(), email.trim(), password)
        setPassword("")
        setCreated(true)
      } else {
        const signedIn = await signIn(email.trim(), password)
        // Organizers land on the organizer dashboard; everyone else on their own dashboard.
        navigate(signedIn.role === "ADMIN" ? ADMIN_PATH : "/dashboard")
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
            <Link className="portal-cta" to={user.role === "ADMIN" ? ADMIN_PATH : "/dashboard"}>
              {user.role === "ADMIN" ? "Open organizer dashboard" : "Open my registrations"} <span>↗</span>
            </Link>
          </>
        ) : (
          <form className="portal-form" onSubmit={handleSubmit} noValidate aria-busy={busy}>
            {justSignedUp && <div className="success-message portal-notice">Account created. Log in with your new password.</div>}
            {error && (
              <div className="portal-error" role="alert">
                {error}
              </div>
            )}
            {isSignup && (
              <div className="portal-field">
                <label htmlFor="portal-name">Full name</label>
                <input
                  id="portal-name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); clearFieldError("name") }}
                  autoComplete="name"
                  maxLength={100}
                  placeholder="Your full name"
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? "portal-name-error" : undefined}
                />
                {fieldErrors.name && <p id="portal-name-error" className="portal-field-error">{fieldErrors.name}</p>}
              </div>
            )}
            <div className="portal-field">
              <label htmlFor="portal-email">Email address</label>
              <input
                id="portal-email"
                type="email"
                placeholder="you@campus.edu"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearFieldError("email") }}
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? "portal-email-error" : undefined}
              />
              {fieldErrors.email && <p id="portal-email-error" className="portal-field-error">{fieldErrors.email}</p>}
            </div>
            <div className="portal-field">
              <label htmlFor="portal-password">Password</label>
              <input
                id="portal-password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearFieldError("password") }}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={isSignup ? "At least 10 characters" : "Your password"}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? "portal-password-error" : isSignup ? "portal-password-hint" : undefined}
              />
              {fieldErrors.password ? (
                <p id="portal-password-error" className="portal-field-error">{fieldErrors.password}</p>
              ) : (
                isSignup && <p id="portal-password-hint" className="portal-field-hint">Use at least 10 characters.</p>
              )}
            </div>
            <button type="submit" className="portal-submit" disabled={busy}>
              <span>{busy ? (isSignup ? "Creating account…" : "Logging in…") : isSignup ? "Create account" : "Log in"}</span>
              {busy ? <span className="portal-spinner" aria-hidden="true" /> : <span aria-hidden="true">↗</span>}
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
