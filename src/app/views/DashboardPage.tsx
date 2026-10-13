import { FormEvent, useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import {
  ApiError,
  type Registration,
  type User,
  PARTICIPANT_STATUS_LABELS,
  registrationTitle,
  apiConfigured,
  getStoredUser,
  myRegistrations,
  paymentQrUrl,
  rupees,
  signOut,
  submitPaymentProof,
  ticketQrUrl,
} from "../api"
import SignInPanel from "../components/SignInPanel"
import { eventAnalytics } from "../api"
import { ADMIN_PATH } from "../adminPath"

const STEPS = ["Registered", "Waiting for approval", "Approved"] as const

function stepIndex(status: Registration["status"]) {
  if (status === "PAYMENT_REVIEW" || status === "PAYMENT_VERIFIED") return 1
  if (status === "APPROVED" || status === "TICKET_ISSUED") return 2
  return 0
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

// Each member's entry QR, the same one that was emailed to them.
function EntryTickets({ registration }: { registration: Registration }) {
  const [images, setImages] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    for (const member of registration.participants) {
      ticketQrUrl(registration.id, member.id)
        .then((url) => {
          urls.push(url)
          if (!cancelled) setImages((current) => ({ ...current, [member.id]: url }))
        })
        .catch(() => !cancelled && setError("Couldn't load the entry QR codes. Refresh to try again."))
    }
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [registration.id, registration.participants])

  return (
    <div className="entry-tickets">
      <p className="form-section-title">Entry tickets</p>
      <p className="account-muted">
        Every member has their own QR, also sent to their email. Show it at the entrance to get your band. Each QR works once.
      </p>
      {error && <div className="modal-error-banner">{error}</div>}
      <div className="entry-ticket-grid">
        {registration.participants.map((member) => (
          <figure key={member.id} className="entry-ticket">
            {images[member.id] ? (
              <img src={images[member.id]} alt={`Entry QR for ${member.name}`} />
            ) : (
              <div className="entry-ticket-placeholder" />
            )}
            <figcaption>
              <strong>{member.name}</strong>
              <span className="receipt-pid">{registration.code}</span>
              <span>
                {member.checkedInAt
                  ? `Entered ${new Date(member.checkedInAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
                  : member.ticketEmailedAt
                    ? "Emailed"
                    : "Email on its way"}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
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
          <h2>{registrationTitle(registration)}</h2>
          <p className="account-reg-id">
            Registration ID <strong className="receipt-pid">{registration.code}</strong>
          </p>
        </div>
        <span className={`status-pill status-pill--${registration.status.toLowerCase()}`}>{PARTICIPANT_STATUS_LABELS[registration.status]}</span>
      </div>

      {!rejected && (
        <ol className="status-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i <= current ? "is-done" : ""}>
              {label}
            </li>
          ))}
        </ol>
      )}
      {registration.status === "PAYMENT_REVIEW" && registration.paymentProofs.length > 1 && (
        <p className="account-muted">Your new payment proof was sent to the organisers for a second check.</p>
      )}
      {registration.status === "PAYMENT_REJECTED" && latestProof?.rejectionReason && (
        <div className="modal-error-banner">Payment rejected: {latestProof.rejectionReason}. Upload your UTR and payment screenshot again below and we&apos;ll check it again.</div>
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

      {(registration.status === "APPROVED" || registration.status === "TICKET_ISSUED") && <EntryTickets registration={registration} />}
      {canPay && <PaymentUpload registration={registration} onDone={onChanged} />}
    </article>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(getStoredUser())
  // Events whose analytics this account may see (shown as a link); empty for everyone else.
  const [analyticsEvents, setAnalyticsEvents] = useState<{ id: string; name: string }[]>([])
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

  useEffect(() => {
    if (!user) return setAnalyticsEvents([])
    eventAnalytics.access().then(setAnalyticsEvents, () => setAnalyticsEvents([]))
  }, [user])

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
            <h1>My registrations</h1>
            <p className="account-muted">Online registration isn&apos;t connected yet. Please check back soon.</p>
          </div>
        ) : !user ? (
          <SignInPanel
            title="My registrations"
            subtitle="Sign in with the account you used to register to see your registrations and their status."
            onSignedIn={setUser}
          />
        ) : (
          <>
            <h1 className="account-title">Hi, {user.name.split(" ")[0]}</h1>
            <p className="account-muted">Your registrations for SHOURYA 2026.</p>
            {analyticsEvents.length > 0 && (
              <Link to="/event-analytics" className="pill-button pill-button--gold" style={{ marginTop: 14 }}>
                Event admin: {analyticsEvents.map((e) => e.name).join(", ")}
              </Link>
            )}
            {user.role === "ADMIN" && (
              <Link to={ADMIN_PATH} className="pill-button pill-button--gold" style={{ marginTop: 14 }}>
                Open organizer dashboard
              </Link>
            )}
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
