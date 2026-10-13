import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import {
  ApiError,
  type EventOverview,
  type Registration,
  type RegistrationStatus,
  type User,
  STATUS_LABELS,
  apiConfigured,
  eventAdmin,
  eventAnalytics,
  getStoredUser,
  rupees,
  signOut,
} from "../api"
import SignInPanel from "../components/SignInPanel"
import { AdminRegistration, RecordsExplorer, TotalsCards, qualityNotes } from "./AdminPage"

const STATUS_TABS: { label: string; status?: RegistrationStatus }[] = [
  { label: "Payment review", status: "PAYMENT_REVIEW" },
  { label: "Approved", status: "APPROVED" },
  { label: "Ticket issued", status: "TICKET_ISSUED" },
  { label: "Awaiting payment", status: "PENDING_PAYMENT" },
  { label: "Payment rejected", status: "PAYMENT_REJECTED" },
  { label: "Rejected", status: "REJECTED" },
  { label: "All" },
]

// Approvals for this event admin's events: the same cards organizers use, with actions the server
// limits to these events. Approving here updates the same registration everyone else sees.
function EventRegistrations() {
  const [rows, setRows] = useState<Registration[] | null>(null)
  const [tab, setTab] = useState(0)
  const [eventId, setEventId] = useState("")
  const [search, setSearch] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      setRows(await eventAdmin.registrations())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the registrations")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const events = [...new Map((rows ?? []).map((r) => [r.event.id, r.event.name])).entries()]
  const inEvent = (rows ?? []).filter((r) => !eventId || r.event.id === eventId)
  const count = (status?: RegistrationStatus) => inEvent.filter((r) => !status || r.status === status).length
  const term = search.trim().toLowerCase()
  const shown = inEvent.filter(
    (r) =>
      (!STATUS_TABS[tab].status || r.status === STATUS_TABS[tab].status) &&
      (!term ||
        r.code.toLowerCase().includes(term) ||
        (r.teamName ?? "").toLowerCase().includes(term) ||
        r.participants.some((p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term))),
  )

  return (
    <section className="account-card">
      <h2>Registrations</h2>
      <p className="account-muted">
        Open a registration to see its members, payment screenshot and UTR, then tap Approve payment: each member is emailed their
        entry QR. Your actions are recorded with your name and show up for the organizers straight away.
      </p>
      {events.length > 1 && (
        <div className="admin-filters admin-event-filters" aria-label="Event">
          <button type="button" className={`size-tab ${eventId === "" ? "size-tab--active" : ""}`} onClick={() => setEventId("")}>
            <strong>All my events ({rows?.length ?? 0})</strong>
          </button>
          {events.map(([id, name]) => (
            <button key={id} type="button" className={`size-tab ${eventId === id ? "size-tab--active" : ""}`} onClick={() => setEventId(id)}>
              <strong>{name} ({(rows ?? []).filter((r) => r.event.id === id).length})</strong>
            </button>
          ))}
        </div>
      )}
      <div className="admin-filters">
        {STATUS_TABS.map((t, i) => (
          <button key={t.label} type="button" className={`size-tab ${tab === i ? "size-tab--active" : ""}`} onClick={() => setTab(i)}>
            <strong>{t.label} ({count(t.status)})</strong>
          </button>
        ))}
      </div>
      <input className="admin-search" type="search" aria-label="Find a registration" placeholder="Find a registration: ID, team, member name or email"
        value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
      {notice && <p className="success-sync-notice" style={{ justifyContent: "flex-start" }}>✓ {notice}</p>}
      {error && <div className="modal-error-banner">{error}</div>}
      {rows === null && !error && <p className="account-muted">Loading…</p>}
      {rows && shown.length === 0 && <p className="account-muted">No registrations here{STATUS_TABS[tab].status ? ` (${STATUS_LABELS[STATUS_TABS[tab].status!]})` : ""}.</p>}
      {shown.map((registration) => (
        <AdminRegistration key={registration.id} registration={registration} onChanged={load} onNotice={setNotice} actions={eventAdmin} />
      ))}
    </section>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

// Read-only analytics for the events this account was given (e.g. an event's coordinator). The same
// views as the super admin analytics, limited by the server to those events: no other events, no
// global totals, no test-data rules, no organizer actions.
export default function EventAnalyticsPage() {
  const [user, setUser] = useState<User | null>(getStoredUser())
  const [data, setData] = useState<EventOverview | null>(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refresh = false) => {
    setError("")
    setLoading(true)
    try {
      setData(await eventAnalytics.overview(refresh))
      setDenied(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null)
      else if (err instanceof ApiError && err.status === 403) setDenied(true)
      else setError(err instanceof Error ? err.message : "Couldn't load the analytics")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  return (
    <main className="account-page">
      <div className="account-shell account-shell--wide">
        <div className="account-topbar">
          <Link to="/" className="back-link">← Back to the festival</Link>
          {user && (
            <button type="button" className="pill-button pill-button--outline account-signout"
              onClick={() => { signOut(); setUser(null); setData(null) }}>
              Sign out
            </button>
          )}
        </div>

        {!apiConfigured ? (
          <div className="account-card"><h1>Event analytics</h1><p className="account-muted">The registration server isn&apos;t connected yet.</p></div>
        ) : !user ? (
          <SignInPanel title="Event analytics" subtitle="Sign in with the account that was given access to an event's analytics." onSignedIn={setUser} />
        ) : denied ? (
          <div className="account-card">
            <h1>Event analytics</h1>
            <p className="account-muted">{user.email} doesn&apos;t have access to any event&apos;s analytics. Ask the organizers if you should.</p>
          </div>
        ) : (
          <>
          <EventRegistrations />
          <section className="account-card admin-overview">
            <div className="admin-overview-head">
              <h2>Event admin · analytics</h2>
              <button type="button" className="pill-button pill-button--outline account-signout" onClick={() => void load(true)} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <p className="account-muted">
              For {data ? data.events.map((e) => e.name).join(", ") : "your events"}. Read from each event&apos;s tab in the Google Sheet.
              {data && ` Read ${formatDate(data.readAt)}.`}
            </p>
            {data?.stale && <div className="modal-error-banner">⚠ {data.staleReason}</div>}
            {error && <div className="modal-error-banner">{error}</div>}
            {!data && !error && <p className="account-muted">Loading…</p>}
            {data && (
              <>
                <TotalsCards totals={data.totals.production} />
                {qualityNotes(data).length > 0 && <div className="admin-quality-note">Sheet check: {qualityNotes(data).join("; ")}.</div>}
                <div className="admin-overview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Registrations</th>
                        <th>Accepted teams</th>
                        <th>Participants</th>
                        <th>Amount</th>
                        <th>Paid ✓</th>
                        <th>Entered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((row) => (
                        <tr key={row.eventId}>
                          <td>{row.name}</td>
                          <td>{row.production.registrations}</td>
                          <td>{row.production.approvedTeams}</td>
                          <td>{row.production.approvedParticipants}</td>
                          <td>{rupees(row.production.approvedAmountPaise)}</td>
                          <td>{row.production.paymentsVerified}</td>
                          <td>{row.production.participantsEntered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <RecordsExplorer
                  events={data.events}
                  version={0}
                  source={{ records: eventAnalytics.records, downloadCsv: eventAnalytics.downloadCsv }}
                  showTestData={false}
                />
              </>
            )}
          </section>
          </>
        )}
      </div>
    </main>
  )
}
