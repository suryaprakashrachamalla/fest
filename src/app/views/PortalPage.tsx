import { FormEvent, useState } from "react"
import { Link, useLocation } from "react-router"

export default function PortalPage() {
  const { pathname } = useLocation()
  const isSignup = pathname === "/signup"
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
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
        <p className="eyebrow">{isSignup ? "First access" : "Welcome back"}</p>
        <h1>{isSignup ? "Be first in line." : "Enter the arena."}</h1>
        <p>
          {isSignup
            ? "Registration isn't live yet. Join the first-access list and we'll tell you when it drops."
            : "The participant portal opens with registration. Leave your email to get notified."}
        </p>
        {submitted ? (
          <div className="success-message">
            <span>✓</span>
            You&apos;re on the list. We&apos;ll see you soon.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              required
              type="email"
              placeholder="you@campus.edu"
            />
            <button type="submit">
              Notify me <span>↗</span>
            </button>
          </form>
        )}
        <Link className="back-link" to="/">
          ← Back to the festival
        </Link>
      </section>
    </main>
  )
}
