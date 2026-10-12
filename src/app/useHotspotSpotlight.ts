import { useEffect, useState } from "react"

// After the intro and the SHOURYA reveal, scroll to the Hotspot block and spotlight it on the page:
// the rest dims, a beam lands on the hotspot events, holds for a second, then everything fades back.
// Plays once per page load, never for reduced motion, and backs off if the visitor scrolls first.
const AFTER_LOGO_MS = 1400 // lets the gold logo finish fading in
const SCROLL_MS = 1000
const ENTER_MS = 700
const HOLD_MS = 1000
const EXIT_MS = 700

let played = false

export type SpotlightPhase = "" | "is-spotlit" | "is-spotlit is-spotlit-exit"

export default function useHotspotSpotlight(ready: boolean, targetId: string): SpotlightPhase {
  const [phase, setPhase] = useState<SpotlightPhase>("")

  useEffect(() => {
    if (!ready || played) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const target = document.getElementById(targetId)
    if (!target) return

    const timers: number[] = []
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms))
    let cancelled = false
    // A visitor who starts scrolling on their own keeps control of the page.
    const cancel = () => {
      cancelled = true
    }
    const userInput = ["wheel", "touchstart", "keydown"] as const
    userInput.forEach((type) => window.addEventListener(type, cancel, { passive: true, once: true }))

    later(AFTER_LOGO_MS, () => {
      userInput.forEach((type) => window.removeEventListener(type, cancel))
      // Marked here, not up front, so a StrictMode effect re-run still plays it once.
      played = true
      if (cancelled) return
      const rect = target.getBoundingClientRect()
      const offset = Math.max(90, (window.innerHeight - rect.height) / 2)
      window.scrollTo({ top: window.scrollY + rect.top - offset, behavior: "smooth" })
      later(SCROLL_MS, () => setPhase("is-spotlit"))
      later(SCROLL_MS + ENTER_MS + HOLD_MS, () => setPhase("is-spotlit is-spotlit-exit"))
      later(SCROLL_MS + ENTER_MS + HOLD_MS + EXIT_MS, () => setPhase(""))
    })

    return () => {
      timers.forEach(clearTimeout)
      userInput.forEach((type) => window.removeEventListener(type, cancel))
    }
  }, [ready, targetId])

  return phase
}
