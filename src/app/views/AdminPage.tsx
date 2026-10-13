import { FormEvent, useCallback, useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import {
  ApiError,
  type AnalyticsExclusion,
  type AnalyticsRecord,
  type AnalyticsTotals,
  type AuditEntry,
  type EventOverview,
  type EventOverviewRow,
  type ExclusionSuggestion,
  type RecordQuery,
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

const PAYMENT_OPTIONS = [
  ["", "Any payment"],
  ["NOT_SUBMITTED", "Not submitted"],
  ["PENDING", "Under review"],
  ["VERIFIED", "Verified"],
  ["REJECTED", "Rejected"],
]
const APPROVAL_OPTIONS = [
  ["", "Any approval"],
  ["APPROVED", "Approved"],
  ["PENDING", "Pending"],
  ["REJECTED", "Rejected"],
]

function TotalsCards({ totals }: { totals: AnalyticsTotals }) {
  const cards: [string, string | number][] = [
    ["Registrations", totals.registrations],
    ["Accepted teams", totals.approvedTeams],
    ["Accepted participants", totals.approvedParticipants],
    ["Accepted amount", rupees(totals.approvedAmountPaise)],
    ["Payments verified", totals.paymentsVerified],
    ["Payments under review", totals.paymentsUnderReview],
    ["Participants entered", totals.participantsEntered],
  ]
  return (
    <div className="admin-overview-totals">
      {cards.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function qualityNotes(data: EventOverview) {
  const notes: string[] = []
  const q = data.dataQuality
  if (q.rowsWithoutId) notes.push(`${q.rowsWithoutId} row(s) without a registration ID were skipped`)
  if (q.duplicateIds.length) notes.push(`repeated rows for ${q.duplicateIds.join(", ")} were counted once`)
  if (q.rowsWithProblems) notes.push(`${q.rowsWithProblems} row(s) have unreadable cells (counted as 0)`)
  for (const tab of q.tabsMissingColumns) notes.push(`the "${tab.tab}" tab is missing ${tab.missingColumns.join(", ")}`)
  return notes
}

// Super-admin rules that keep test data out of the analytics. Nothing is deleted: excluded records
// stay in the sheet and the database and are listed under "Test data".
function ExclusionManager({ onChanged }: { onChanged: () => void }) {
  const [rules, setRules] = useState<AnalyticsExclusion[] | null>(null)
  const [suggestions, setSuggestions] = useState<ExclusionSuggestion[]>([])
  const [kind, setKind] = useState<"REGISTRATION" | "ACCOUNT">("REGISTRATION")
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const [list, suggested] = await Promise.all([admin.exclusions(), admin.exclusionSuggestions()])
      setRules(list)
      setSuggestions(suggested)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the test data rules")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function exclude(k: "REGISTRATION" | "ACCOUNT", v: string, why: string) {
    setBusy(true)
    setError("")
    setNote("")
    try {
      await admin.addExclusion(k, v.trim(), why.trim())
      setNote(`${v.trim()} is now left out of the production numbers.`)
      setValue("")
      setReason("")
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the rule")
    } finally {
      setBusy(false)
    }
  }

  async function remove(rule: AnalyticsExclusion) {
    if (!window.confirm(`Count ${rule.value} in the production numbers again?`)) return
    setBusy(true)
    setError("")
    setNote("")
    try {
      await admin.removeExclusion(rule.id)
      setNote(`${rule.value} is counted again.`)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the rule")
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="admin-panel">
      <summary>Test data rules ({rules?.length ?? 0})</summary>
      <p className="account-muted">
        Leave a test registration, or every registration made by a test account, out of the production numbers. Nothing is deleted:
        those records stay in the Google Sheet and are listed under Records → Test data.
      </p>
      <form
        className="admin-exclusion-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim() || reason.trim().length < 3) return setError("Enter what to exclude and a reason (at least 3 characters).")
          void exclude(kind, value, reason)
        }}
        noValidate
      >
        <div className="form-field">
          <label htmlFor="exclusion-kind">Exclude</label>
          <select id="exclusion-kind" value={kind} onChange={(e) => setKind(e.target.value as "REGISTRATION" | "ACCOUNT")}>
            <option value="REGISTRATION">One registration (by ID)</option>
            <option value="ACCOUNT">A whole account (by sign-in email)</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="exclusion-value">{kind === "REGISTRATION" ? "Registration ID" : "Account email"}</label>
          <input
            id="exclusion-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "REGISTRATION" ? "SG26-3H8945J2" : "tester@gmail.com"}
            maxLength={254}
          />
        </div>
        <div className="form-field">
          <label htmlFor="exclusion-reason">Reason</label>
          <input id="exclusion-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Test registration by the web team" maxLength={200} />
        </div>
        <button type="submit" className="pill-button pill-button--gold" disabled={busy}>
          {busy ? "Saving…" : "Exclude from analytics"}
        </button>
      </form>
      {note && <p className="success-sync-notice" style={{ justifyContent: "flex-start", margin: "10px 0 0" }}>✓ {note}</p>}
      {error && <div className="modal-error-banner" style={{ marginTop: 10 }}>{error}</div>}

      {rules && rules.length > 0 && (
        <ul className="admin-rule-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span>
                <strong>{rule.value}</strong>
                <em>
                  {rule.kind === "ACCOUNT" ? `Account · ${rule.registrations} registration${rule.registrations === 1 ? "" : "s"}` : "Registration"} ·{" "}
                  {rule.reason} · by {rule.createdBy ?? "unknown"}, {formatDate(rule.createdAt)}
                </em>
              </span>
              <button type="button" className="pill-button pill-button--outline account-signout" onClick={() => void remove(rule)} disabled={busy}>
                Count again
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <>
          <p className="form-section-title">Suggested test accounts (review before excluding)</p>
          <ul className="admin-rule-list">
            {suggestions.map((suggestion) => (
              <li key={suggestion.value}>
                <span>
                  <strong>
                    {suggestion.value} <small className={`admin-signal admin-signal--${suggestion.signal}`}>{suggestion.signal} signal</small>
                  </strong>
                  <em>
                    {suggestion.name} · {suggestion.reasons.join("; ")} · {suggestion.registrations.join(", ")}
                  </em>
                </span>
                <button
                  type="button"
                  className="pill-button pill-button--outline account-signout"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Leave every registration by ${suggestion.value} out of the production numbers?`) &&
                    void exclude("ACCOUNT", suggestion.value, suggestion.reasons[0])
                  }
                >
                  Exclude account
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  )
}

// The registrations behind the numbers, with the same rules: search, filters, pages and a CSV export.
function RecordsExplorer({ events, version }: { events: EventOverviewRow[]; version: number }) {
  const [query, setQuery] = useState<RecordQuery>({ scope: "production", page: 1, pageSize: 25 })
  const [search, setSearch] = useState("")
  const [result, setResult] = useState<Awaited<ReturnType<typeof admin.analyticsRecords>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let current = true
    setLoading(true)
    setError("")
    admin
      .analyticsRecords(query)
      .then((data) => current && setResult(data))
      .catch((err) => current && setError(err instanceof Error ? err.message : "Couldn't load the records"))
      .finally(() => current && setLoading(false))
    return () => {
      current = false
    }
  }, [query, version])

  const update = (patch: Partial<RecordQuery>) => setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }))
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1

  return (
    <details className="admin-panel" open>
      <summary>Records</summary>
      <form
        className="admin-record-filters"
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: search.trim() || undefined })
        }}
      >
        <input aria-label="Search records" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Registration ID, name or email" maxLength={100} />
        <select aria-label="Event" value={query.event ?? ""} onChange={(e) => update({ event: e.target.value || undefined })}>
          <option value="">All events</option>
          {events.map((event) => (
            <option key={event.eventId} value={event.eventId}>{event.name}</option>
          ))}
        </select>
        <select aria-label="Payment" value={query.payment ?? ""} onChange={(e) => update({ payment: e.target.value || undefined })}>
          {PAYMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Approval" value={query.approval ?? ""} onChange={(e) => update({ approval: e.target.value || undefined })}>
          {APPROVAL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Data" value={query.scope} onChange={(e) => update({ scope: e.target.value as RecordQuery["scope"] })}>
          <option value="production">Production data</option>
          <option value="excluded">Test data only</option>
          <option value="all">Everything</option>
        </select>
        <label className="admin-date">From <input type="date" value={query.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} /></label>
        <label className="admin-date">To <input type="date" value={query.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} /></label>
        <button type="submit" className="pill-button pill-button--gold">Search</button>
        <button
          type="button"
          className="pill-button pill-button--outline"
          disabled={exporting}
          onClick={async () => {
            setExporting(true)
            setError("")
            try {
              await admin.downloadRecordsCsv({ ...query, page: undefined, pageSize: undefined })
            } catch (err) {
              setError(err instanceof Error ? err.message : "Export failed")
            } finally {
              setExporting(false)
            }
          }}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </form>
      {error && <div className="modal-error-banner">{error}</div>}
      {loading && !result && <p className="account-muted">Loading…</p>}
      {result && (
        <>
          <p className="account-muted">
            {result.total} record{result.total === 1 ? "" : "s"}
            {query.scope === "excluded" ? " of test data" : query.scope === "all" ? " (production and test data)" : ""}
            {loading ? " · updating…" : ""}
            {result.stale ? " · ⚠ from the last successful read of the sheet" : ""}
          </p>
          {result.records.length === 0 ? (
            <p className="account-muted">No records match.</p>
          ) : (
            <div className="admin-overview-table">
              <table>
                <thead>
                  <tr>
                    <th>Registration ID</th>
                    <th>Event</th>
                    <th>Team / participants</th>
                    <th>Fee</th>
                    <th>Payment</th>
                    <th>Approval</th>
                    <th>Entered</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((record: AnalyticsRecord) => (
                    <tr key={record.registrationId} className={record.excluded ? "is-test-data" : ""}>
                      <td>
                        <strong>{record.registrationId}</strong>
                        {record.excluded && <em className="admin-test-badge" title={record.exclusionReason ?? ""}>test data</em>}
                      </td>
                      <td>{record.event}</td>
                      <td>
                        {record.teamName ? `${record.teamName}: ` : ""}
                        {record.participantNames}
                        <em className="admin-overview-note"> · {record.emails.join(", ")}</em>
                      </td>
                      <td>{rupees(record.registrationFeePaise)}</td>
                      <td>{record.paymentStatus}</td>
                      <td>{record.approvalStatus}</td>
                      <td>{record.membersEntered}/{record.teamSize}</td>
                      <td>{formatDate(record.registeredAt || null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="admin-pager">
              <button type="button" className="pill-button pill-button--outline account-signout" disabled={result.page <= 1 || loading} onClick={() => update({ page: result.page - 1 })}>
                ← Previous
              </button>
              <span>Page {result.page} of {pages}</span>
              <button type="button" className="pill-button pill-button--outline account-signout" disabled={result.page >= pages || loading} onClick={() => update({ page: result.page + 1 })}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </details>
  )
}

// Analytics for super admins, read from each event's tab in the Google Sheet. Hidden for other
// organizers, whom the server refuses.
function SuperAdminOverview() {
  const [data, setData] = useState<EventOverview | null>(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Bumped when the test data rules change, so the records reload with them.
  const [version, setVersion] = useState(0)

  const load = useCallback(async (refresh = false) => {
    setError("")
    setLoading(true)
    try {
      setData(await admin.overview(refresh))
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setHidden(true)
      else setError(err instanceof Error ? err.message : "Couldn't load the overview")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (hidden) return null
  const excluded = data?.totals.excluded
  const notes = data ? qualityNotes(data) : []
  return (
    <section className="account-card admin-overview">
      <div className="admin-overview-head">
        <h2>Analytics</h2>
        <button type="button" className="pill-button pill-button--outline account-signout" onClick={() => void load(true)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="account-muted">
        Super admins only. Read from each event&apos;s tab in the Google Sheet. These are production numbers: test data excluded by the
        rules below is counted separately, never deleted.
        {data && ` Read ${formatDate(data.readAt)}.`}
      </p>
      {data?.stale && <div className="modal-error-banner">⚠ {data.staleReason}</div>}
      {error && <div className="modal-error-banner">{error}</div>}
      {!data && !error && <p className="account-muted">Loading…</p>}
      {data && (
        <>
          <TotalsCards totals={data.totals.production} />
          {excluded && excluded.registrations > 0 ? (
            <p className="admin-overview-excluded">
              Test data left out: {excluded.registrations} registration{excluded.registrations === 1 ? "" : "s"}, {excluded.participants}{" "}
              participant{excluded.participants === 1 ? "" : "s"}, {rupees(excluded.approvedAmountPaise)} accepted. Listed under Records → Test data.
            </p>
          ) : (
            <p className="account-muted">No test data is excluded{data.exclusionRules ? "" : " yet (no rules)"}.</p>
          )}
          {!data.allMatchDatabase && (
            <div className="modal-error-banner">
              Some event tabs don&apos;t match the database yet (marked ⚠). The sheet usually catches up within a minute; tap Refresh,
              or use Retry sync below if it persists.
            </div>
          )}
          {notes.length > 0 && <div className="admin-quality-note">Sheet check: {notes.join("; ")}.</div>}
          <div className="admin-overview-table">
            <table>
              <thead>
                <tr>
                  <th>Event (sheet tab)</th>
                  <th>Registrations</th>
                  <th>Accepted teams</th>
                  <th>Participants</th>
                  <th>Amount</th>
                  <th>Paid ✓</th>
                  <th>Entered</th>
                  <th>Test data</th>
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
                    <td>{row.production.registrations}</td>
                    <td>{row.production.approvedTeams}</td>
                    <td>{row.production.approvedParticipants}</td>
                    <td>{rupees(row.production.approvedAmountPaise)}</td>
                    <td>{row.production.paymentsVerified}</td>
                    <td>{row.production.participantsEntered}</td>
                    <td>{row.excluded.registrations || "—"}</td>
                    <td>{row.matchesDatabase ? "✓" : `⚠ database has ${row.databaseApprovedTeams}`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{data.totals.production.registrations}</td>
                  <td>{data.totals.production.approvedTeams}</td>
                  <td>{data.totals.production.approvedParticipants}</td>
                  <td>{rupees(data.totals.production.approvedAmountPaise)}</td>
                  <td>{data.totals.production.paymentsVerified}</td>
                  <td>{data.totals.production.participantsEntered}</td>
                  <td>{data.totals.excluded.registrations || "—"}</td>
                  <td>{data.allMatchDatabase ? "✓" : "⚠"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <ExclusionManager
        onChanged={() => {
          void load()
          setVersion((v) => v + 1)
        }}
      />
      <RecordsExplorer events={data?.events ?? []} version={version} />
    </section>
  )
}

// Organizers upload the real UPI QR here; the active one is shown to everyone who registers.
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
            <small>{fee.heading}</small>
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
        {registration.discountCode && (
          <span className="admin-row-note">
            Team code {registration.discountCode}: {rupees(registration.discountPaise ?? 0)} off (fee {rupees(registration.amountPaise + (registration.discountPaise ?? 0))}).
          </span>
        )}
        {fee.total - (registration.discountPaise ?? 0) !== registration.amountPaise && (
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
  const [screenshots, setScreenshots] = useState<Awaited<ReturnType<typeof admin.screenshotStorage>> | null>(null)
  const [notice, setNotice] = useState("")
  // Finds a registration in the current list by ID, team, member name, email or phone.
  const [search, setSearch] = useState("")
  // An entry QR scanned with a phone camera opens /admin?ticket=<code>; it is checked after sign-in.
  const [searchParams, setSearchParams] = useSearchParams()
  const scannedTicket = searchParams.get("ticket")
  const clearScannedTicket = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams])
  const [error, setError] = useState("")
  const [sessionExpired, setSessionExpired] = useState(false)
  const isAdmin = user?.role === "ADMIN"
  const term = search.trim().toLowerCase()
  const visibleRows = (rows ?? []).filter(
    (r) =>
      !term ||
      r.code.toLowerCase().includes(term) ||
      (r.teamName ?? "").toLowerCase().includes(term) ||
      r.phone.replace(/\s/g, "").includes(term.replace(/\s/g, "")) ||
      r.participants.some((p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term)),
  )

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
      setScreenshots(await admin.screenshotStorage().catch(() => null))
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
            {screenshots && (
              <div className="admin-sync">
                <p className="account-muted">
                  Payment screenshots:{" "}
                  {screenshots.driveConnected
                    ? `${screenshots.inDrive} in Google Drive · ${screenshots.inDatabase} waiting to be copied${screenshots.failed ? ` · ${screenshots.failed} failed (retried automatically)` : ""}`
                    : `stored in the database (${screenshots.inDatabase}); Google Drive isn't connected`}
                </p>
              </div>
            )}
            {notice && <p className="success-sync-notice" style={{ justifyContent: "flex-start" }}>✓ {notice}</p>}
            {error && <div className="modal-error-banner">{error}</div>}
            {rows === null && !error && <p className="account-muted">Loading…</p>}
            <input
              className="admin-search"
              type="search"
              aria-label="Find a registration"
              placeholder="Find a registration: ID, team, member name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
            />
            {rows?.length === 0 && <p className="account-muted">No registrations here.</p>}
            {rows && rows.length > 0 && visibleRows.length === 0 && <p className="account-muted">No registrations here match "{search.trim()}".</p>}
            {visibleRows.map((registration) => (
              <AdminRegistration key={registration.id} registration={registration} onChanged={load} onNotice={setNotice} />
            ))}
          </>
        )}
      </div>
    </main>
  )
}
