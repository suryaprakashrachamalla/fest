import { useEffect, useState } from "react"
import { Link } from "react-router"
import Footer from "../components/Footer"
import Header from "../components/Header"
import { categories, events } from "../events"

const registrationDate = new Date("2026-10-10T00:00:00+05:30").getTime()

function RegistrationCountdown() {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, registrationDate - Date.now()),
  )

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRemaining(Math.max(0, registrationDate - Date.now()))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [])

  if (remaining <= 0) return null

  const totalSeconds = Math.floor(remaining / 1000)
  const countdown = [
    ["Days", Math.floor(totalSeconds / 86400)],
    ["Hours", Math.floor((totalSeconds % 86400) / 3600)],
    ["Minutes", Math.floor((totalSeconds % 3600) / 60)],
    ["Seconds", totalSeconds % 60],
  ] as const

  return (
    <div className="registration-countdown" aria-label="Registration countdown">
      <p>Registration opens · October 10</p>
      <div>
        {countdown.map(([label, value]) => (
          <span key={label}>
            <strong>{String(value).padStart(2, "0")}</strong>
            <small>{label}</small>
          </span>
        ))}
      </div>
    </div>
  )
}

function EventCard({
  event,
  index,
}: {
  event: typeof events[number]
  index: number
}) {
  return (
    <article
      className="event-card"
      style={{ "--accent": event.accent } as React.CSSProperties}
    >
      <Link
        className="event-visual"
        to={`/events/${event.slug}`}
        aria-label={`View ${event.name}`}
      >
        <img src={event.image} alt="" />
        <span className="event-index">{event.number}</span>
        <span className="event-arrow">↗</span>
        <div className="scan-line" />
      </Link>
      <div className="event-copy">
        <div>
          <p className="eyebrow">
            {event.category} <span>—</span> {event.date}
          </p>
          <h3>{event.name}</h3>
        </div>
        <Link className="event-link" to={`/events/${event.slug}`}>
          Explore event <span>↗</span>
        </Link>
      </div>
      <p className="event-tagline">
        {event.time} · {event.tagline}
      </p>
      <span className="card-order">0{index + 1}</span>
    </article>
  )
}

export default function HomePage() {
  return (
    <div className="festival-site">
      <Header />

      <main>
        <section className="hero">
          <div className="hero-noise" />
          <div className="hero-orbit hero-orbit--one" />
          <div className="hero-orbit hero-orbit--two" />
          <div className="binary-particles" aria-hidden="true">
            {Array.from({ length: 34 }, (_, index) => (
              <span
                key={index}
                style={
                  {
                    "--x": `${(index * 37) % 100}%`,
                    "--delay": `${-((index * 0.73) % 11)}s`,
                    "--duration": `${8 + (index % 7)}s`,
                    "--size": `${10 + (index % 5) * 3}px`,
                  } as React.CSSProperties
                }
              >
                {index % 3 === 0 ? "1" : "0"}
              </span>
            ))}
          </div>
          <div className="code-rain" aria-hidden="true">
            {[
              "01001101 01010110 01010011 01010010",
              "const future = build(idea);",
              "10110100 00101101 11001010",
              "<create> ship(); repeat();",
              "01110011 01101000 01101111 01110101",
              "while (curious) { explore(); }",
              "11001001 01010110 00110101",
              "git commit -m 'make it real'",
            ].map((line, index) => (
              <span
                key={line}
                style={{ "--line": index } as React.CSSProperties}
              >
                {line}
              </span>
            ))}
          </div>

          <div
            className="hero-type hero-type--registration"
            aria-label="Registrations open soon"
          >
            <div className="hero-line hero-line--top">
              <span>REGISTRATIONS</span>
            </div>
            <div className="hero-line hero-line--bottom">
              <span className="outline-word">OPENS</span>
              <span>SOON</span>
            </div>
          </div>

          <RegistrationCountdown />

          <div className="hero-meta">
            <p>
              A campus festival for people who build,
              <br /> perform, question, and create.
            </p>
            <a href="#events">
              Scroll to discover
              <span className="scroll-line" />
            </a>
          </div>
        </section>

        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            <span>BUILD / BREAK / REMIX / PERFORM / CREATE /</span>
            <span>BUILD / BREAK / REMIX / PERFORM / CREATE /</span>
          </div>
        </div>

        <section id="events" className="events-section">
          <div className="section-heading">
            <p className="eyebrow">The 2026 line-up</p>
            <h2>
              Seven events.
              <br />
              <em>Zero spectators.</em>
            </h2>
            <p className="section-intro">
              Choose your arena. Build something bold, own the stage, or show up
              for the beautiful chaos in between.
            </p>
          </div>

          {categories.map((category) => {
            const categoryEvents = events.filter(
              (event) => event.category === category,
            )
            return (
              <section
                id={category.toLowerCase().replace("-", "-").replace(" ", "-")}
                className="category-block"
                key={category}
              >
                <div className="category-heading">
                  <span>
                    {String(categories.indexOf(category) + 1).padStart(2, "0")}
                  </span>
                  <h3>{category}</h3>
                  <p>
                    {categoryEvents.length} event
                    {categoryEvents.length > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="events-grid">
                  {categoryEvents.map((event, index) => (
                    <EventCard event={event} index={index} key={event.slug} />
                  ))}
                </div>
              </section>
            )
          })}
        </section>

        <section className="cta-section">
          <div className="cta-ring">
            <span>REGISTRATION OPENS SOON · STAY IN THE LOOP · </span>
          </div>
          <p className="eyebrow">Don&apos;t miss the drop</p>
          <Link className="big-cta" to="/signup">
            Get first access <span>↗</span>
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  )
}
