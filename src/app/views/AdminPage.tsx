import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import {
  type AuditEntry,
  type Registration,
  type RegistrationStatus,
  type User,
  STATUS_LABELS,
  admin,
  apiConfigured,
  getStoredUser,
  rupees,
  signOut,
} from "../api"
import SignInPanel from "../components/SignInPanel"

const FILTERS: { label: string; status?: RegistrationStatus }[] = [
  { label: "Payment review", status: "PAYMENT_REVIEW" },
  { label: "Payment verified", status: "PAYMENT_VERIFIED" },
  { label: "Approved", status: "APPROVED" },
  { label: "Awaiting payment", status: "PENDING_PAYMENT" },
  { label: "Payment rejected", status: "PAYMENT_REJECTED" },
  { label: "Rejected", status: "REJECTED" },
  { label: "All" },
]

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""
}

function AdminRegistration({ registration, onChanged }: { registration: Registration; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [reason, setReason] = useState("")
  const [screenshots, setScreenshots] = useState<Record<string, string>>({})
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const pendingProof = registration.paymentProofs.find((p) => p.status === "PENDING")

  async function act(label: string, action: () => Promise<unknown>) {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await action()
      setMessage(label)
      setReason("")
      setAudit(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed")
    } finally {
      setBusy(false)
    }
  }

  function needReason() {
    if (reason.trim().length < 3) {
      setError("Write a reason (at least 3 characters) in the box first.")
      return false
    }
    return true
  }

  return (
    <article className="account-card admin-row">
      <button type="button" className="admin-row-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="receipt-pid">{registration.code}</span>
        <strong>{registration.teamName}</strong>
        <span className="account-muted">{registration.event.name} · {registration.teamSize} members · {rupees(registration.amountPaise)}</span>
        <span className={`status-pill status-pill--${registration.status.toLowerCase()}`}>{STATUS_LABELS[registration.status]}</span>
      </button>

      {open && (
        <div className="admin-row-body">
          <div className="success-receipt-box account-receipt">
            <div className="receipt-row"><span>Account</span><strong>{registration.user?.name} · {registration.user?.email}</strong></div>
            <div className="receipt-row"><span>College</span><strong>{registration.college}</strong></div>
            <div className="receipt-row"><span>Phone</span><strong>{registration.phone}</strong></div>
            <div className="receipt-row"><span>Registered</span><strong>{formatDate(registration.createdAt)}</strong></div>
            {registration.rejectionReason && (
              <div className="receipt-row"><span>Rejection reason</span><strong>{registration.rejectionReason}</strong></div>
            )}
          </div>

          <p className="form-section-title">Team members</p>
          <ul className="account-members">
            {registration.participants.map((p, i) => (
              <li key={p.id}>
                <span>Student {i + 1}</span>
                <strong>{p.name}</strong>
                <em>{p.email}{p.rollNumber ? ` · ${p.rollNumber}` : ""}</em>
              </li>
            ))}
          </ul>

          <p className="form-section-title">Payment proofs</p>
          {registration.paymentProofs.length === 0 && <p className="account-muted">No payment submitted yet.</p>}
          {registration.paymentProofs.map((proof) => (
            <div key={proof.id} className="admin-proof">
              <div>
                <strong>{proof.paymentMethod} · UTR {proof.utr}</strong>
                <span className="account-muted">
                  {proof.status} · submitted {formatDate(proof.submittedAt)}
                  {proof.rejectionReason ? ` · ${proof.rejectionReason}` : ""}
                </span>
              </div>
              {screenshots[proof.id] ? (
                <a href={screenshots[proof.id]} target="_blank" rel="noreferrer">
                  <img src={screenshots[proof.id]} alt={`Payment screenshot for UTR ${proof.utr}`} />
                </a>
              ) : (
                <button
                  type="button"
                  className="pill-button pill-button--outline"
                  onClick={async () => {
                    try {
                      const url = await admin.screenshotUrl(proof.id)
                      setScreenshots((s) => ({ ...s, [proof.id]: url }))
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Couldn't load screenshot")
                    }
                  }}
                >
                  View screenshot
                </button>
              )}
            </div>
          ))}

          <p className="form-section-title">Actions</p>
          <div className="form-field">
            <label htmlFor={`reason-${registration.id}`}>Reason (needed to reject a payment or registration)</label>
            <input id={`reason-${registration.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <div className="admin-actions">
            {pendingProof && (
              <>
                <button type="button" className="pill-button pill-button--gold" disabled={busy}
                  onClick={() => act("Payment verified", () => admin.verifyProof(pendingProof.id))}>
                  Verify payment
                </button>
                <button type="button" className="pill-button pill-button--outline" disabled={busy}
                  onClick={() => needReason() && act("Payment rejected", () => admin.rejectProof(pendingProof.id, reason.trim()))}>
                  Reject payment
                </button>
              </>
            )}
            {registration.status === "PAYMENT_VERIFIED" && (
              <button type="button" className="pill-button pill-button--gold" disabled={busy}
                onClick={() => act("Registration approved", () => admin.approve(registration.id))}>
                Approve registration
              </button>
            )}
            {registration.status !== "REJECTED" && registration.status !== "TICKET_ISSUED" && !registration.entered && (
              <button type="button" className="pill-button pill-button--outline" disabled={busy}
                onClick={() => needReason() && act("Registration rejected", () => admin.reject(registration.id, reason.trim()))}>
                Reject registration
              </button>
            )}
            <button type="button" className="pill-button pill-button--outline" disabled={busy}
              onClick={async () => {
                try {
                  setAudit(await admin.audit(registration.id))
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Couldn't load history")
                }
              }}>
              Audit history
            </button>
          </div>
          {message && <p className="success-sync-notice" style={{ justifyContent: "flex-start", marginTop: 12 }}>✓ {message}</p>}
          {error && <div className="modal-error-banner" style={{ marginTop: 12 }}>{error}</div>}
          {audit && (
            <ol className="audit-list">
              {audit.map((entry) => (
                <li key={entry.id}>
                  <span>{formatDate(entry.createdAt)}</span>
                  <strong>{entry.action.replace(/_/g, " ").toLowerCase()}</strong>
                  <em>
                    {entry.actor ? `${entry.actor.name}${entry.actor.role === "ADMIN" ? " (organizer)" : ""}` : "system"}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </em>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  )
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(getStoredUser())
  const [filter, setFilter] = useState(0)
  const [rows, setRows] = useState<Registration[] | null>(null)
  const [sync, setSync] = useState<Awaited<ReturnType<typeof admin.syncStatus>> | null>(null)
  const [syncNote, setSyncNote] = useState("")
  const [error, setError] = useState("")
  const isAdmin = user?.role === "ADMIN"

  const load = useCallback(async () => {
    setError("")
    try {
      setRows(await admin.registrations(FILTERS[filter].status))
      setSync(await admin.syncStatus().catch(() => null))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load registrations.")
    }
  }, [filter])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  return (
    <main className="account-page">
      <div className="account-shell account-shell--wide">
        <div className="account-topbar">
          <Link to="/" className="back-link">← Back to the festival</Link>
          {user && (
            <button type="button" className="pill-button pill-button--outline account-signout"
              onClick={() => { signOut(); setUser(null); setRows(null) }}>
              Sign out
            </button>
          )}
        </div>

        {!apiConfigured ? (
          <div className="account-card"><h1>Organizer dashboard</h1><p className="account-muted">The registration server isn&apos;t connected yet.</p></div>
        ) : !user ? (
          <SignInPanel title="Organizer dashboard" subtitle="Sign in with an organizer account." onSignedIn={setUser} />
        ) : !isAdmin ? (
          <div className="account-card">
            <h1>Organizer dashboard</h1>
            <p className="account-muted">{user.email} isn&apos;t an organizer account. Sign out and sign in with an organizer account.</p>
          </div>
        ) : (
          <>
            <h1 className="account-title">Registrations</h1>
            <div className="admin-filters">
              {FILTERS.map((f, i) => (
                <button key={f.label} type="button" className={`size-tab ${filter === i ? "size-tab--active" : ""}`} onClick={() => setFilter(i)}>
                  <strong>{f.label}</strong>
                </button>
              ))}
            </div>
            {sync && (
              <div className="admin-sync">
                <p className="account-muted">
                  Google Sheets:{" "}
                  {sync.configured
                    ? `${sync.counts.COMPLETED ?? 0} synced · ${sync.counts.PENDING ?? 0} pending · ${sync.counts.FAILED ?? 0} failed`
                    : "not configured yet (registrations are safely stored in the database)"}
                  {sync.lastError ? ` · last error: ${sync.lastError}` : ""}
                </p>
                {sync.configured && (
                  <button
                    type="button"
                    className="pill-button pill-button--outline account-signout"
                    onClick={async () => {
                      setSyncNote("")
                      try {
                        await admin.retrySync()
                        setSyncNote("Sync re-checked and failed rows queued for retry.")
                        void load()
                      } catch (err) {
                        setSyncNote(err instanceof Error ? err.message : "Retry failed")
                      }
                    }}
                  >
                    Retry sync
                  </button>
                )}
                {syncNote && <p className="account-muted">{syncNote}</p>}
              </div>
            )}
            {error && <div className="modal-error-banner">{error}</div>}
            {rows === null && !error && <p className="account-muted">Loading…</p>}
            {rows?.length === 0 && <p className="account-muted">No registrations here.</p>}
            {rows?.map((registration) => (
              <AdminRegistration key={registration.id} registration={registration} onChanged={load} />
            ))}
          </>
        )}
      </div>
    </main>
  )
}
