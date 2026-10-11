import { FormEvent, useState } from "react"
import { type User, signIn } from "../api"

export default function SignInPanel({
  title,
  subtitle,
  onSignedIn,
}: {
  title: string
  subtitle: string
  onSignedIn: (user: User) => void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      onSignedIn(await signIn(email.trim(), password))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-card account-signin" onSubmit={handleSubmit}>
      <h1>{title}</h1>
      <p className="account-muted">{subtitle}</p>
      {error && <div className="modal-error-banner">{error}</div>}
      <div className="form-field">
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      <div className="form-field" style={{ marginTop: 14 }}>
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" className="pill-button pill-button--gold pill-button--full" style={{ marginTop: 22 }} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
