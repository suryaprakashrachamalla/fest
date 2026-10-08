import { useState } from "react"
import { Link, useParams } from "react-router"
import Footer from "../components/Footer"
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

  const isHackathon = event.slug === "hackathon"
  const pricingTag = isHackathon
    ? "₹300 / person · 2–3 members"
    : "Registration opens soon"

  return (
    <div
      className="event-page"
      style={{ "--accent": event.accent } as React.CSSProperties}
    >
      <Header light />
      <main>
        <section className="event-hero">
          <img src={event.image} alt={`${event.name} atmosphere`} />
          <div className="event-hero-overlay" />
          <p className="event-breadcrumb">
            <Link to="/">Shourya 2026</Link> / {event.category} / {event.number}
          </p>
          <div className="event-hero-title">
            <p>{event.tagline}</p>
            <h1>{event.name}</h1>
          </div>
          <span className="event-hero-number">{event.number}</span>
        </section>

        <section className="event-details">
          <div className="event-description">
            <p className="eyebrow">About this event</p>
            <h2>{event.description}</h2>
            <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center" }}>
              <button
                type="button"
                className="pill-button pill-button--gold"
                onClick={() => setIsRegisterOpen(true)}
              >
                Register Team Now <span>↗</span>
              </button>
              <span style={{ fontSize: "13px", color: "#f4c97a", fontFamily: "DM Mono, monospace" }}>
                ⚡ {pricingTag}
              </span>
            </div>
          </div>
          <div className="event-facts">
            {[
              ["Fee", isHackathon ? "₹300 / head (2–3 members)" : "Announced soon"],
              ["Format", event.format],
              ["Team", event.team],
              ["Date", event.date],
              ["Time", event.time],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="event-criteria">
          <div>
            <p className="eyebrow">What matters</p>
            <h2>
              Bring the idea.
              <br />
              We&apos;ll bring the arena.
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

        <section className="detail-cta">
          <p style={{ color: "#f4c97a" }}>{isHackathon ? "Registration is Live" : "Registration opens soon"}</p>
          <h2>
            Ready to make
            <br />
            some noise?
          </h2>
          <button
            type="button"
            className="pill-button pill-button--gold"
            onClick={() => setIsRegisterOpen(true)}
            style={{ fontSize: "16px", padding: "16px 36px" }}
          >
            Register for {event.name} <span>↗</span>
          </button>
        </section>
      </main>

      <RegistrationModal
        event={event}
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
      />

      <Footer />
    </div>
  )
}
