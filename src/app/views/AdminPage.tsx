import { FormEvent, useCallback, useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import {
  ApiError,
  type AuditEntry,
  type EventOverview,
  type PaymentQr,
  type Registration,
  type RegistrationStatus,
  type User,
  STATUS_LABELS,
  admin,
  apiConfigured,
  feeBreakdown,
  getStoredUser,
  registrationTitle,
  rupees,
  signOut,
} from "../api"
import SignInPanel from "../components/SignInPanel"
import TicketScanner from "../components/TicketScanner"

const FILTERS: { label: string; status?: RegistrationStatus }[] = [
  { label: "Payment review", status: "PAYMENT_REVIEW" },
  { label: "Payment verified", status: "PAYMENT_VERIFIED" },
  { label: "Approved", status: "APPROVED" },
  { label: "Ticket issued", status: "TICKET_ISSUED" },
  { label: "Awaiting payment", status: "PENDING_PAYMENT" },
  { label: "Payment rejected", status: "PAYMENT_REJECTED" },
  { label: "Rejected", status: "REJECTED" },
  { label: "All" },
]


// 2 -> "2nd", 3 -> "3rd", 11 -> "11th"
function ordinal(n: number) {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"
  return `${n}${suffix}`
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""
}

// Organizers upload the real UPI QR here; the active one is shown to everyone who registers.
// Totals per event for super admins. Hidden for other organizers, whom the server refuses.
function SuperAdminOverview() {
  const [data, setData] = useState<EventOverview | null>(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      setData(await admin.overview())
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setHidden(true)
      else setError(err instanceof Error ? err.message : "Couldn't load the overview")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (hidden) return null
  return (
    <section className="account-card admin-overview">
      <div className="admin-overview-head">
        <h2>Overview</h2>
        <button type="button" className="pill-button pill-button--outline account-signout" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p className="account-muted">
        Super admins only. Read from each event&apos;s tab in the Google Sheet, counting accepted (approved) registrations only.
        {data && ` Read ${formatDate(data.readAt)}.`}
      </p>
      {error && <div className="modal-error-banner">{error}</div>}
      {!data && !error && <p className="account-muted">Loading…</p>}
      {data && (
        <>
          <div className="admin-overview-totals">
            <div><small>Accepted teams</small><strong>{data.totals.approvedTeams}</strong></div>
            <div><small>Accepted participants</small><strong>{data.totals.approvedParticipants}</strong></div>
            <div><small>Accepted amount</small><strong>{rupees(data.totals.approvedAmountPaise)}</strong></div>
          </div>
          {!data.allMatchDatabase && (
            <div className="modal-error-banner">
              Some event tabs don&apos;t match the database yet (marked ⚠). The sheet usually catches up within a minute; tap Refresh,
              or use Retry sync below if it persists.
            </div>
          )}
          <div className="admin-overview-table">
            <table>
              <thead>
                <tr>
                  <th>Event (sheet tab)</th>
                  <th>Accepted teams</th>
                  <th>Participants</th>
                  <th>Amount</th>
                  <th>Matches database</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((row) => (
                  <tr key={row.eventId}>
                    <td>
                      {row.name}
                      {!row.tabFound && <em className="admin-overview-note"> · no tab yet</em>}
                    </td>
                    <td>{row.approvedTeams}</td>
                    <td>{row.approvedParticipants}</td>
                    <td>{rupees(row.approvedAmountPaise)}</td>
                    <td>{row.matchesDatabase ? "✓" : `⚠ database has ${row.databaseApprovedTeams}`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{data.totals.approvedTeams}</td>
                  <td>{data.totals.approvedParticipants}</td>
                  <td>{rupees(data.totals.approvedAmountPaise)}</td>
                  <td>{data.allMatchDatabase ? "✓" : "⚠"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function PaymentQrManager() {
  const [qrs, setQrs] = useState<PaymentQr[] | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const [label, setLabel] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const list = await admin.paymentQrs()
      setQrs(list)
      for (const qr of list) {
        admin.paymentQrImageUrl(qr.id).then((url) => setImages((m) => ({ ...m, [qr.id]: url }))).catch(() => {})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load QR codes")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(e: FormEvent) {
    e.preventDefault()
    setError("")
    setNote("")
    if (!label.trim()) return setError("Give the QR code a name, e.g. the UPI ID or account holder.")
    if (!file || !["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024)
      return setError("Choose a PNG or JPG image of the QR code, up to 5 MB.")
    setBusy(true)
    try {
      const created = await admin.addPaymentQr(label.trim(), file)
      await admin.setPaymentQrActive(created.id, true)
      setNote(`"${created.label}" uploaded and is now shown to everyone who registers.`)
      setLabel("")
      setFile(null)
      ;(e.target as HTMLFormElement).reset()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }

  async function activate(qr: PaymentQr) {
    setError("")
    setNote("")
    try {
      await admin.setPaymentQrActive(qr.id, true)
      setNote(`"${qr.label}" is now the payment QR.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch the QR code")
    }
  }

  const active = qrs?.find((qr) => qr.isActive)

  return (
    <section className="account-card admin-qr">
      <h2>Payment QR code</h2>
      <p className="account-muted">
        {active
          ? `Registrants see "${active.label}". Upload a new one to replace it.`
          : "No QR uploaded yet, so registrants see the demo QR with a \"don't pay\" warning. Upload your real UPI QR to go live."}
      </p>
      {qrs && qrs.length > 0 && (
        <div className="admin-qr-list">
          {qrs.map((qr) => (
            <div key={qr.id} className={`admin-qr-item ${qr.isActive ? "admin-qr-item--active" : ""}`}>
              {images[qr.id] ? <img src={images[qr.id]} alt={`QR code ${qr.label}`} /> : <div className="admin-qr-placeholder" />}
              <strong>{qr.label}</strong>
              <span className="account-muted">Added {formatDate(qr.createdAt)}</span>
              {qr.isActive ? (
                <span className="status-pill status-pill--approved">Live</span>
              ) : (
                <button type="button" className="pill-button pill-button--outline account-signout" onClick={() => activate(qr)}>
                  Use this QR
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <form className="admin-qr-form" onSubmit={upload} noValidate>
        <div className="form-field">
          <label htmlFor="qr-label">Name (e.g. UPI ID)</label>
          <input id="qr-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="mvsrfest@upi" />
        </div>
        <div className="form-field">
          <label htmlFor="qr-file">QR image (PNG or JPG)</label>
          <input id="qr-file" type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <button type="submit" className="pill-button pill-button--gold" disabled={busy}>
          {busy ? "Uploading…" : "Upload & make live"}
        </button>
      </form>
      {note && <p className="success-sync-notice" style={{ justifyContent: "flex-start", margin: "12px 0 0" }}>✓ {note}</p>}
      {error && <div className="modal-error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
    </section>
  )
}

// Entry QR email progress for a team, e.g. "Emailed 3/3".
function ticketSummary(registration: Registration) {
  const total = registration.participants.length
  const sent = registration.participants.filter((p) => p.ticketEmailedAt).length
  const failed = registration.participants.find((p) => !p.ticketEmailedAt && p.ticketEmailError)
  if (failed) return `Emailed ${sent}/${total} · failed for ${failed.name}: ${failed.ticketEmailError}`
  if (sent === total) return `Entry QR emailed to all ${total} member${total === 1 ? "" : "s"}`
  return sent ? `Emailed ${sent}/${total}, sending the rest…` : "Waiting to be emailed"
}

function AdminRegistration({
  registration,
  onChanged,
  onNotice,
}: {
  registration: Registration
  onChanged: () => void
  // Page-level message that stays visible after the team moves to another filter.
  onNotice: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [reason, setReason] = useState("")
  const [screenshots, setScreenshots] = useState<Record<string, string>>({})
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const pendingProof = registration.paymentProofs.find((p) => p.status === "PENDING")
  const ticketed = registration.status === "APPROVED" || registration.status === "TICKET_ISSUED"
  const membersIn = registration.participants.filter((p) => p.checkedInAt).length
  // Fee model from the event; the total shown is the amount the server stored at registration.
  const fee = feeBreakdown(registration.event, registration.teamSize)
  const latestProof = registration.paymentProofs[0]
  // Proofs come newest first, so the latest is attempt N; a pending one after a rejection is a re-check.
  const attempts = registration.paymentProofs.length
  const reverify = latestProof?.status === "PENDING" && attempts > 1
  const payment = !latestProof
    ? { tone: "pending", label: "— Not submitted" }
    : latestProof.status === "VERIFIED"
      ? { tone: "ok", label: "✓ Verified" }
      : latestProof.status === "REJECTED"
        ? { tone: "bad", label: "✗ Rejected" }
        : { tone: "pending", label: reverify ? `⏳ ${ordinal(attempts)} verification` : "⏳ Under review" }
  const approval = ticketed
    ? { tone: "ok", label: registration.status === "TICKET_ISSUED" ? "✓ Approved · tickets sent" : "✓ Approved" }
    : registration.status === "REJECTED"
      ? { tone: "bad", label: "✗ Rejected" }
      : { tone: "pending", label: "⏳ Pending" }

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
        <span className="admin-row-top">
          <strong className="admin-row-event">{registration.event.name}</strong>
          <strong className="admin-row-id receipt-pid">{registration.code}</strong>
          {reverify && <span className="admin-reverify-badge">🔁 {ordinal(attempts)} verification · resubmitted</span>}
        </span>
        <span className="admin-row-title">
          {registration.teamName ? `Team ${registration.teamName}` : `${registrationTitle(registration)} · individual`}
        </span>
        <span className="admin-row-facts">
          <span>
            <small>Participants</small>
            <strong>{registration.teamSize}</strong>
          </span>
          <span>
            <small>{fee.perParticipant ? "Fee per participant" : "Flat fee"}</small>
            <strong>{rupees(fee.unit)}</strong>
          </span>
          <span>
            <small>Total</small>
            <strong>{rupees(registration.amountPaise)}</strong>
          </span>
          <span className={`admin-fact admin-fact--${payment.tone}`}>
            <small>Payment</small>
            <strong>{payment.label}</strong>
          </span>
          <span className={`admin-fact admin-fact--${approval.tone}`}>
            <small>Approval</small>
            <strong>{approval.label}</strong>
          </span>
        </span>
        {fee.total !== registration.amountPaise && (
          <span className="admin-row-note">
            Charged {rupees(registration.amountPaise)} at registration; the current fee for {registration.teamSize} would be{" "}
            {rupees(fee.total)}.
          </span>
        )}
        <span className="admin-row-toggle" aria-hidden="true">{open ? "Hide details ▲" : "Show details ▼"}</span>
      </button>

      {open && (
        <div className="admin-row-body">
          <div className="success-receipt-box account-receipt">
            <div className="receipt-row"><span>Account</span><strong>{registration.user?.name} · {registration.user?.email}</strong></div>
            <div className="receipt-row"><span>College</span><strong>{registration.college}</strong></div>
            <div className="receipt-row"><span>Phone</span><strong>{registration.phone}</strong></div>
            <div className="receipt-row"><span>Registered</span><strong>{formatDate(registration.createdAt)}</strong></div>
            {registration.verifiedBy && (
              <div className="receipt-row">
                <span>Payment verified by</span>
                <strong>{registration.verifiedBy.name} · {formatDate(registration.verifiedAt ?? null)}</strong>
              </div>
            )}
            {registration.approvedBy && (
              <div className="receipt-row">
                <span>Approved by</span>
                <strong>{registration.approvedBy.name} · {formatDate(registration.approvedAt)}</strong>
              </div>
            )}
            {registration.rejectionReason && (
              <div className="receipt-row"><span>Rejection reason</span><strong>{registration.rejectionReason}</strong></div>
            )}
            {ticketed && (
              <div className="receipt-row"><span>Entry tickets</span><strong>{ticketSummary(registration)}</strong></div>
            )}
            {(membersIn > 0 || registration.entered) && (
              <div className="receipt-row">
                <span>Entrance</span>
                <strong>
                  {membersIn > 0
                    ? `${membersIn}/${registration.participants.length} members entered`
                    : `Team checked in ${formatDate(registration.enteredAt ?? null)}`}
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
                <em>
                  {p.email}{p.rollNumber ? ` · ${p.rollNumber}` : ""}
                  {ticketed && (p.ticketEmailedAt ? " · QR emailed" : p.ticketEmailError ? " · QR email failed" : " · QR not sent yet")}
                  {p.checkedInAt ? ` · entered ${formatDate(p.checkedInAt)}${p.checkedInBy ? ` by ${p.checkedInBy.name}` : ""}` : ""}
                </em>
              </li>
            ))}
          </ul>

          <p className="form-section-title">Payment proofs</p>
          {registration.paymentProofs.length === 0 && <p className="account-muted">No payment submitted yet.</p>}
          {registration.paymentProofs.map((proof, index) => (
            <div key={proof.id} className={`admin-proof ${index === 0 && reverify ? "admin-proof--reverify" : ""}`}>
              <div>
                {attempts > 1 && (
                  <span className="admin-proof-attempt">
                    Attempt {attempts - index}
                    {index === 0 && reverify ? " · resubmitted after rejection" : ""}
                  </span>
                )}
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
            {(pendingProof || registration.status === "PAYMENT_VERIFIED") && (
              // One click: verifies the payment, approves the team and emails every member their entry QR.
              <button type="button" className="pill-button pill-button--gold" disabled={busy}
                onClick={() => act(
                  `Approved. Each of the ${registration.participants.length} members is being emailed their entry QR.`,
                  async () => {
                    await admin.approve(registration.id)
                    onNotice(
                      `${registrationTitle(registration)} (${registration.code}) approved. Entry QR emails are going to ${registration.participants
                        .map((p) => p.name)
                        .join(", ")}. Find the team under "Ticket issued" once they're sent.`,
                    )
                    // Refresh again once the first emails have gone out, so the counts update.
                    window.setTimeout(onChanged, 8000)
                  },
                )}>
                {busy ? "Approving…" : "Approve payment"}
              </button>
            )}
            {pendingProof && (
              <button type="button" className="pill-button pill-button--outline" disabled={busy}
                onClick={() => needReason() && act("Payment rejected", () => admin.rejectProof(pendingProof.id, reason.trim()))}>
                Reject payment
              </button>
            )}
            {ticketed && (
              <button type="button" className="pill-button pill-button--outline" disabled={busy}
                onClick={() => act("Entry QR emails queued again for every member", () => admin.resendTickets(registration.id))}>
                Resend tickets
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
  const [counts, setCounts] = useState<Partial<Record<RegistrationStatus | "ALL", number>>>({})
  const [sync, setSync] = useState<Awaited<ReturnType<typeof admin.syncStatus>> | null>(null)
  const [syncNote, setSyncNote] = useState("")
  const [mail, setMail] = useState<Awaited<ReturnType<typeof admin.ticketMailStatus>> | null>(null)
  const [notice, setNotice] = useState("")
  // An entry QR scanned with a phone camera opens /admin?ticket=<code>; it is checked after sign-in.
  const [searchParams, setSearchParams] = useSearchParams()
  const scannedTicket = searchParams.get("ticket")
  const clearScannedTicket = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams])
  const [error, setError] = useState("")
  const [sessionExpired, setSessionExpired] = useState(false)
  const isAdmin = user?.role === "ADMIN"

  // The server rejected the sign-in (expired or revoked): show the sign-in form once, with a reason.
  const expireSession = useCallback(() => {
    signOut()
    setUser(null)
    setRows(null)
    setSessionExpired(true)
  }, [])

  const load = useCallback(async () => {
    setError("")
    try {
      const all = await admin.registrations()
      const tally: Partial<Record<RegistrationStatus | "ALL", number>> = { ALL: all.length }
      for (const r of all) tally[r.status] = (tally[r.status] ?? 0) + 1
      setCounts(tally)
      const status = FILTERS[filter].status
      setRows(status ? all.filter((r) => r.status === status) : all)
      setSync(await admin.syncStatus().catch(() => null))
      setMail(await admin.ticketMailStatus().catch(() => null))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return expireSession()
      setError(err instanceof Error ? err.message : "Couldn't load registrations.")
    }
  }, [filter, expireSession])

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
          <SignInPanel
            title="Organizer dashboard"
            subtitle={
              sessionExpired
                ? "Your sign-in expired (sign-ins last 12 hours). Sign in again; scanning continues after that."
                : scannedTicket
                  ? "This is a SHOURYA'26 entry ticket. Sign in with an organizer account to check it in."
                  : "Sign in with an organizer account."
            }
            onSignedIn={(signedIn) => {
              setSessionExpired(false)
              setUser(signedIn)
            }}
          />
        ) : !isAdmin ? (
          <div className="account-card">
            <h1>Organizer dashboard</h1>
            <p className="account-muted">{user.email} isn&apos;t an organizer account. Sign out and sign in with an organizer account.</p>
          </div>
        ) : (
          <>
            <h1 className="account-title">Organizer dashboard</h1>
            <SuperAdminOverview />
            <TicketScanner initialCode={scannedTicket} onInitialCodeHandled={clearScannedTicket} onSessionExpired={expireSession} />
            <PaymentQrManager />
            <h2 className="account-subtitle">Registrations</h2>
            <p className="account-muted">
              Open a team to see its members, payment screenshot and UTR, then tap Approve payment: each member is emailed
              their own entry QR. Every action is recorded with your name and synced to Google Sheets.
            </p>
            <div className="admin-filters">
              {FILTERS.map((f, i) => (
                <button key={f.label} type="button" className={`size-tab ${filter === i ? "size-tab--active" : ""}`} onClick={() => setFilter(i)}>
                  <strong>{f.label} ({counts[f.status ?? "ALL"] ?? 0})</strong>
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
            {mail && (
              <div className="admin-sync">
                <p className="account-muted">
                  Entry ticket emails:{" "}
                  {mail.configured
                    ? `on · ${mail.pending} waiting to send${mail.failed ? ` · ${mail.failed} failed (open the team to resend)` : ""}`
                    : "not set up yet. Approved teams get their QR emails as soon as the mail settings are added."}
                </p>
              </div>
            )}
            {notice && <p className="success-sync-notice" style={{ justifyContent: "flex-start" }}>✓ {notice}</p>}
            {error && <div className="modal-error-banner">{error}</div>}
            {rows === null && !error && <p className="account-muted">Loading…</p>}
            {rows?.length === 0 && <p className="account-muted">No registrations here.</p>}
            {rows?.map((registration) => (
              <AdminRegistration key={registration.id} registration={registration} onChanged={load} onNotice={setNotice} />
            ))}
          </>
        )}
      </div>
    </main>
  )
}
