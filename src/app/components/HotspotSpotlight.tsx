import { useEffect, useState } from "react"
import { Link } from "react-router"
import type { FestivalEvent } from "../events"
import { onIntroDone } from "../introState"

// Spotlight on the Hotspot events right after the intro: the beam drops in, holds for a second,
// then everything sweeps out. Plays once per page load; a click or Escape skips it.
const START_DELAY = 900 // lets the intro curtain finish lifting first
const ENTER_MS = 900
const HOLD_MS = 1000
const EXIT_MS = 700

let played = false

type Phase = "idle" | "enter" | "exit" | "done"

export default function HotspotSpotlight({ events }: { events: FestivalEvent[] }) {
  const [phase, setPhase] = useState<Phase>("idle")

  useEffect(() => {
    if (played || events.length === 0) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timers: number[] = []
    const stop = onIntroDone(() => {
      played = true
      timers.push(
        window.setTimeout(() => setPhase("enter"), START_DELAY),
        window.setTimeout(() => setPhase("exit"), START_DELAY + ENTER_MS + HOLD_MS),
        window.setTimeout(() => setPhase("done"), START_DELAY + ENTER_MS + HOLD_MS + EXIT_MS),
      )
    })
    return () => {
      stop()
      timers.forEach(clearTimeout)
    }
  }, [events.length])

  const skip = () => {
    setPhase("exit")
    window.setTimeout(() => setPhase("done"), EXIT_MS)
  }

  useEffect(() => {
    if (phase !== "enter") return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && skip()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase])

  if (phase === "idle" || phase === "done") return null

  return (
    <div className={`hotspot-spotlight is-${phase}`} onClick={skip} role="dialog" aria-label="Hotspot events">
      <div className="hotspot-spotlight-beam" aria-hidden="true" />
      <div className="hotspot-spotlight-stage">
        <p className="hotspot-spotlight-eyebrow">🔥 Hotspot</p>
        <div className="hotspot-spotlight-cards">
          {events.map((event, index) => (
            <Link
              key={event.slug}
              to={`/events/${event.slug}`}
              className="hotspot-spotlight-card"
              style={{ "--i": index } as React.CSSProperties}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={event.cardImage ?? event.image} alt="" />
              <strong>{event.name}</strong>
              <em>{event.hotspot}</em>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
