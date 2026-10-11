import { FormEvent, useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import {
  ApiError,
  type Registration,
  type User,
  STATUS_LABELS,
  apiConfigured,
  getStoredUser,
  myRegistrations,
  paymentQrUrl,
  rupees,
  signOut,
  submitPaymentProof,
} from "../api"
import SignInPanel from "../components/SignInPanel"

const STEPS = [
  { key: "PENDING_PAYMENT", label: "Registered" },
  { key: "PAYMENT_REVIEW", label: "Payment under review" },
  { key: "PAYMENT_VERIFIED", label: "Payment verified" },
  { key: "APPROVED", label: "Approved" },
] as const

function stepIndex(status: Registration["status"]) {
  if (status === "PAYMENT_REJECTED") return 0
  if (status === "TICKET_ISSUED") return STEPS.length - 1
  return Math.max(0, STEPS.findIndex((s) => s.key === status))
}

function PaymentUpload({ registration, onDone }: { registration: Registration; onDone: () => void }) {
  const [utr, setUtr] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [qr, setQr] = useState<{ url: string; isDemo: boolean } | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void paymentQrUrl().then(setQr)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!/^[A-Za-z0-9-]{6,32}$/.test(utr.trim())) return setError("Enter the UTR / transaction reference (6–32 letters or numbers).")
    if (!file || !["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024)
      return setError("Upload a PNG or JPG payment screenshot up to 5 MB.")
    setError("")
    setBusy(true)
    try {
      await submitPaymentProof(registration.id, utr.trim(), "UPI", file)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-upload" onSubmit={handleSubmit} noValidate>
      <p className="form-section-title">Submit payment</p>
      <div className="payment-qr-box">
        {qr ? <img src={qr.url} alt="UPI payment QR code" /> : <div className="payment-qr-placeholder" />}
        <div>
          <p>
            Pay exactly <strong>{rupees(registration.amountPaise)}</strong> with any UPI app.
          </p>
          {qr?.isDemo && <p className="payment-qr-demo">Demo QR: online payments aren&apos;t live yet. Don&apos;t pay with this code.</p>}
        </div>
      </div>
      <div className="form-grid-2">
        <div className="form-field">
          <label htmlFor={`utr-${registration.id}`}>UTR / transaction reference *</label>
          <input id={`utr-${registration.id}`} value={utr} onChange={(e) => setUtr(e.target.value)} maxLength={32} />
        </div>
        <div className="form-field">
          <label htmlFor={`proof-${registration.id}`}>Payment screenshot *</label>
          <input id={`proof-${registration.id}`} type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      {error && <div className="modal-error-banner" style={{ marginTop: 14 }}>{error}</div>}
      <button type="submit" className="pill-button pill-button--gold" style={{ marginTop: 16 }} disabled={busy}>
        {busy ? "Uploading…" : "Submit payment proof"}
      </button>
    </form>
  )
}

function RegistrationCard({ registration, onChanged }: { registration: Registration; onChanged: () => void }) {
  const current = stepIndex(registration.status)
  const rejected = registration.status === "REJECTED"
  const canPay = registration.status === "PENDING_PAYMENT" || registration.status === "PAYMENT_REJECTED"
  const latestProof = registration.paymentProofs[0]

  return (
    <article className="account-card">
      <div className="account-card-head">
        <div>
          <p className="eyebrow">{registration.event.name}</p>
          <h2>{registration.teamName}</h2>
        </div>
        <span className={`status-pill status-pill--${registration.status.toLowerCase()}`}>{STATUS_LABELS[registration.status]}</span>
      </div>

      {!rejected && (
        <ol className="status-steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i <= current ? "is-done" : ""}>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {registration.status === "PAYMENT_REJECTED" && latestProof?.rejectionReason && (
        <div className="modal-error-banner">Payment rejected: {latestProof.rejectionReason}. Please submit a new payment proof.</div>
      )}
      {rejected && (
        <div className="modal-error-banner">
          This registration was rejected{registration.rejectionReason ? `: ${registration.rejectionReason}` : "."}
        </div>
      )}

      <div className="success-receipt-box account-receipt">
        <div className="receipt-row">
          <span>Registration ID</span>
          <strong className="receipt-pid">{registration.code}</strong>
        </div>
        <div className="receipt-row">
          <span>College</span>
          <strong>{registration.college}</strong>
        </div>
        <div className="receipt-row">
          <span>Phone</span>
          <strong>{registration.phone}</strong>
        </div>
        <div className="receipt-row">
          <span>Fee</span>
          <strong className="receipt-amount">{rupees(registration.amountPaise)}</strong>
        </div>
        {latestProof && (
          <div className="receipt-row">
            <span>Last payment</span>
            <strong>
              {latestProof.paymentMethod} · UTR {latestProof.utr}
            </strong>
          </div>
        )}
      </div>

      <p className="form-section-title">Team members</p>
      <ul className="account-members">
        {registration.participants.map((p, i) => (
          <li key={p.id}>
            <span>Student {i + 1}</span>
            <strong>{p.name}</strong>
            <em>{p.email}</em>
          </li>
        ))}
      </ul>

      {canPay && <PaymentUpload registration={registration} onDone={onChanged} />}
    </article>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(getStoredUser())
  const [registrations, setRegistrations] = useState<Registration[] | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      setRegistrations(await myRegistrations())
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null)
      setError(err instanceof Error ? err.message : "Couldn't load your registrations.")
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  return (
    <main className="account-page">
      <div className="account-shell">
        <div className="account-topbar">
          <Link to="/" className="back-link">
            ← Back to the festival
          </Link>
          {user && (
            <button
              type="button"
              className="pill-button pill-button--outline account-signout"
              onClick={() => {
                signOut()
                setUser(null)
                setRegistrations(null)
              }}
            >
              Sign out
            </button>
          )}
        </div>

        {!apiConfigured ? (
          <div className="account-card">
            <h1>My dashboard</h1>
            <p className="account-muted">Online registration isn&apos;t connected yet. Please check back soon.</p>
          </div>
        ) : !user ? (
          <SignInPanel
            title="My dashboard"
            subtitle="Sign in with the account you used to register to see your registrations and their status."
            onSignedIn={setUser}
          />
        ) : (
          <>
            <h1 className="account-title">Hi, {user.name.split(" ")[0]}</h1>
            <p className="account-muted">Your registrations for MVSR Sangamam 2026.</p>
            {error && <div className="modal-error-banner">{error}</div>}
            {registrations === null && !error && <p className="account-muted">Loading…</p>}
            {registrations?.length === 0 && (
              <div className="account-card">
                <p className="account-muted">You haven&apos;t registered for any event yet.</p>
                <Link to="/" className="pill-button pill-button--gold" style={{ marginTop: 12 }}>
                  Browse events
                </Link>
              </div>
            )}
            {registrations?.map((registration) => (
              <RegistrationCard key={registration.id} registration={registration} onChanged={load} />
            ))}
          </>
        )}
      </div>
    </main>
  )
}
