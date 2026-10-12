import { useEffect, useState } from "react"
import { Link } from "react-router"
import Footer from "../components/Footer"
import Header from "../components/Header"
import GallerySection from "../components/GallerySection"
import ScriptReveal from "../components/ScriptReveal"
import ContactIcon from "../components/ContactIcon"
import { socialLinks } from "../contacts"
import { categories, events } from "../events"
import { publicUrl } from "../publicUrl"

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
        <img src={event.cardImage ?? event.image} alt="" />
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
          Explore <span>↗</span>
        </Link>
      </div>
    </article>
  )
}

export default function HomePage() {
  // Once the script reveal lands, the text gives way to the gold Shourya logo.
  const [showLogo, setShowLogo] = useState(false)

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

          <nav className="hero-social" aria-label="Official social media">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                {...(link.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                aria-label={`${link.label}: ${link.handle}`}
              >
                <ContactIcon icon={link.icon} />
                <span>{link.icon === "instagram" ? link.handle : link.label}</span>
              </a>
            ))}
          </nav>

          <div
            className="hero-type hero-type--registration festival-lockup"
            aria-label="Shourya 2026 Tech Fest at MVSR, October 16 and 17"
          >
            <img className="festival-college-logo" src={publicUrl("/mvsr-logo.png")} alt="Maturi Venkata Subba Rao Engineering College" />
            <p className="festival-dept">Department of Computer Science and Engineering</p>
            <p className="festival-presents">presents</p>
            <div className="shourya-title" aria-hidden="true">
              <span className={`shourya-mark ${showLogo ? "is-logo" : ""}`}>
                <ScriptReveal text="SHOURYA" className="shourya-word" waitForIntro onSettled={() => setShowLogo(true)} />
                <img className="shourya-mark-logo" src={publicUrl("/shourya-logo-gold.png")} alt="" />
              </span>
            </div>

            <p className="festival-label">Tech Fest @MVSREC</p>
            <img className="festival-date" src={publicUrl("/festival-date.webp")} alt="16th & 17th October 2026" />

            <a className="hero-register" href={publicUrl("/#technical")}>
              Register now <span>→</span>
            </a>
            <p className="hero-prize">
              <span>Total prize pool worth</span>
              <strong>₹4L+</strong>
            </p>
          </div>

          <RegistrationCountdown />

          <div className="hero-meta">
            <p>
              A campus festival for people who build,
              <br /> perform, question, and create.
            </p>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "14px", flexWrap: "wrap" }}>
              <Link to="/events/hackathon" className="pill-button pill-button--gold" style={{ padding: "10px 22px", fontSize: "14px" }}>
                Register for CSE-HACKATHON ↗
              </Link>
              <Link to="/events/no-code-vibathon" className="pill-button pill-button--outline" style={{ padding: "10px 22px", fontSize: "14px" }}>
                NOCODE VIBEATHON ↗
              </Link>
            </div>
            <a href="#events" style={{ marginTop: "10px" }}>
              Scroll to discover
              <span className="scroll-line" />
            </a>
          </div>
        </section>



        <section id="events" className="events-section">

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

        <GallerySection />
      </main>

      <Footer />
    </div>
  )
}
