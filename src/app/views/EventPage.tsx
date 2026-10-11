import { useState } from "react"
import { Link, useParams } from "react-router"
import Header from "../components/Header"
import RegistrationModal from "../components/RegistrationModal"
import { events } from "../events"

export default function EventPage() {
  const { slug } = useParams()
  const event = events.find((item) => item.slug === slug)
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)

  if (!event) {
    return (
      <main className="not-found">
        <p>404 / Event not found</p>
        <Link to="/">Back to the festival</Link>
      </main>
    )
  }

  const isWalkIn = event.noRegistration === true
  // Walk-in and on-campus events have no online registration.
  const hasOnlineRegistration = !isWalkIn && !event.registerAt
  // Only events that need 2+ members register as a team.
  const isTeamEvent = /^[2-9]/.test(event.team)
  const criteria = event.criteria ?? { label: "What matters", title: ["Bring the idea.", "We'll bring the arena."] }

  return (
    <div
      className="event-page"
      style={{ "--accent": event.accent } as React.CSSProperties}
    >
      <Header light />
      <main>
        <section className="event-hero">
          <img src={event.image} alt={`${event.name} atmosphere`} style={{ objectPosition: event.imagePosition }} />
          <div className="event-hero-overlay" />
          {/* Returns to this event's category on the home page. */}
          <Link className="event-back" to="/" state={{ scrollTo: event.category.toLowerCase().replace(" ", "-") }}>
            <span aria-hidden="true">←</span> Back to events
          </Link>
          <p className="event-breadcrumb">
            <Link to="/">Shourya 2026</Link> / {event.category} / {event.number}
          </p>
          <div
            className={`event-hero-title ${event.name.length > 20 ? "event-hero-title--long" : ""}`}
            style={{ "--longest": Math.max(...event.name.split(" ").map((word) => word.length)) } as React.CSSProperties}
          >
            {event.tagline && <p>{event.tagline}</p>}
            <h1>{event.name}</h1>
            {(event.heroPrize ?? event.prize) && (
              <div className="event-hero-prize">
                <span>{event.heroPrize ? "Total prize pool worth" : "Prize pool"}</span>
                <strong>{event.heroPrize ?? event.prize}</strong>
              </div>
            )}
          </div>
          <span className="event-hero-number">{event.number}</span>
        </section>

        <section className="event-details">
          <div className="event-description">
            <p className="eyebrow">About this event</p>
            <h2>{event.description}</h2>
            {event.performer && (
              <p className="eyebrow event-performer-label">Featuring</p>
            )}
            {event.performer && (
              <a className="event-performer" href={event.performer.instagram} target="_blank" rel="noreferrer">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                </svg>
                <span>
                  <strong>{event.performer.name}</strong>
                  <em>@{event.performer.handle}</em>
                </span>
              </a>
            )}
            {event.performer?.bio && <p className="event-performer-bio">{event.performer.bio}</p>}
            {event.activities && (
              <>
                <p className="eyebrow event-performer-label">Events</p>
                <ol className="event-activities">
                  {event.activities.map((activity, index) => (
                    <li key={activity}>
                      <span>0{index + 1}</span>
                      {activity}
                    </li>
                  ))}
                </ol>
                {event.activitiesNote && <p className="event-performer-bio">{event.activitiesNote}</p>}
              </>
            )}
            {hasOnlineRegistration && (
            <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center" }}>
              <button
                type="button"
                className="pill-button pill-button--gold"
                onClick={() => setIsRegisterOpen(true)}
              >
                {isTeamEvent ? "Register Team Now" : "Register Now"} <span>↗</span>
              </button>
            </div>
            )}
          </div>
          <div className="event-facts">
            {[
              ...(event.registerAt ? [["Registration", event.registerAt]] : []),
              isWalkIn
                ? ["Entry", event.entry ?? "Walk in · No registration"]
                : [event.feeLabel ?? "Fee", event.fee ?? "Announced soon"],
              ...(event.prize ? [["Prize pool", event.prize]] : []),
              ...(event.prizes ?? []),
              ["Format", event.format],
              [event.teamLabel ?? "Team", event.team],
              ["Date", event.date],
              ["Time", event.time],
              ...(event.venue ? [["Venue", event.venue]] : []),
              ...(event.food ? [["Food", event.food]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        {!event.hideCriteria && (
          <section className="event-criteria">
            <div>
              <p className="eyebrow">{criteria.label}</p>
              <h2>
                {criteria.title[0]}
                <br />
                {criteria.title[1]}
              </h2>
            </div>
            <ol>
              {event.challenges.map((challenge, index) => (
                <li key={challenge}>
                  <span>0{index + 1}</span>
                  {challenge}
                </li>
              ))}
            </ol>
          </section>
        )}

      </main>

      {hasOnlineRegistration && (
        <RegistrationModal
          event={event}
          isOpen={isRegisterOpen}
          onClose={() => setIsRegisterOpen(false)}
        />
      )}

    </div>
  )
}
