import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { ApiError, type EventOverview, type User, apiConfigured, eventAnalytics, getStoredUser, rupees, signOut } from "../api"
import SignInPanel from "../components/SignInPanel"
import { RecordsExplorer, TotalsCards, qualityNotes } from "./AdminPage"

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
          <section className="account-card admin-overview">
            <div className="admin-overview-head">
              <h2>Event analytics</h2>
              <button type="button" className="pill-button pill-button--outline account-signout" onClick={() => void load(true)} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <p className="account-muted">
              Read-only, for {data ? data.events.map((e) => e.name).join(", ") : "your events"}. Read from each event&apos;s tab in the Google Sheet.
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
        )}
      </div>
    </main>
  )
}
