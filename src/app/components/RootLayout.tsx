import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useOutlet } from "react-router"
import { markIntroDone } from "../introState"

interface OutletRecord {
  key: string
  node: React.ReactNode
  scrollOffset: number
}

export default function RootLayout() {
  const location = useLocation()
  const outlet = useOutlet()

  const [currentOutlet, setCurrentOutlet] = useState<OutletRecord>(() => ({
    key: location.pathname,
    node: outlet,
    scrollOffset: 0,
  }))
  const [prevOutlet, setPrevOutlet] = useState<OutletRecord | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const navigate = useNavigate()
  // The intro only plays when landing on the home page, never on event or portal pages.
  const [showPreloader, setShowPreloader] = useState(() => location.pathname === "/")

  useEffect(() => {
    if (!showPreloader) markIntroDone()
  }, [showPreloader])
  const [transitionCounter, setTransitionCounter] = useState(0)

  const prevPathRef = useRef(location.pathname)

  // Handle route change transition (Abatable Parallax Sheet Transition)
  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      const scrollPos = window.scrollY

      setPrevOutlet({
        key: prevPathRef.current,
        node: currentOutlet.node,
        scrollOffset: scrollPos,
      })

      setCurrentOutlet({
        key: location.pathname,
        node: outlet,
        scrollOffset: 0,
      })

      setIsTransitioning(true)
      setTransitionCounter((c) => c + 1)
      prevPathRef.current = location.pathname

      // 1100ms matches Abatable's GSAP duration (1.1s - 1.2s)
      const timer = setTimeout(() => {
        setPrevOutlet(null)
        setIsTransitioning(false)
        window.scrollTo(0, 0)
        // Header section links clicked from another page land on that home section.
        const sectionId = (location.state as { scrollTo?: string } | null)?.scrollTo
        // Wait a frame so the page has left its transition layout and can scroll.
        if (sectionId) {
          setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" }), 50)
        }
      }, 1100)

      return () => clearTimeout(timer)
    }
  }, [location.pathname, outlet])

  // Initial Preloader Curtain Reveal (Abatable once-animation)
  // Ensures user lands directly on the Home page header/hero at (0, 0)
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual"
    }

    // Drop any leftover #section so a load or refresh never scrolls down on its own.
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)
    }

    // Force top scroll immediately for clean intro
    window.scrollTo(0, 0)
    if (!showPreloader) return

    const timer = setTimeout(() => {
      setShowPreloader(false)
      window.scrollTo(0, 0)
      requestAnimationFrame(() => {
        window.scrollTo(0, 0)
      })
    }, 2550)

    return () => clearTimeout(timer)
  }, [])

  // Smooth scroll delegation ONLY on user click
  useEffect(() => {
    function handleAnchorClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a")
      if (!target) return

      const rawHref = target.getAttribute("href")
      if (!rawHref) return
      const base = import.meta.env.BASE_URL
      const href = base !== "/" && rawHref.startsWith(`${base}#`) ? rawHref.slice(base.length - 1) : rawHref

      if (href.startsWith("/#") && location.pathname !== "/") {
        e.preventDefault()
        navigate("/", { state: { scrollTo: href.replace("/#", "") } })
      } else if (href.startsWith("/#")) {
        e.preventDefault()
        const id = href.replace("/#", "")
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView({ behavior: "smooth" })
        }
      } else if (href.startsWith("#") && !href.startsWith("#/")) {
        e.preventDefault()
        const id = href.replace("#", "")
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView({ behavior: "smooth" })
        }
      }
    }

    document.addEventListener("click", handleAnchorClick)
    return () => document.removeEventListener("click", handleAnchorClick)
  }, [location.pathname, navigate])

  const getPageTheme = (path: string) => {
    if (path === "/login" || path === "/signup" || path === "/dashboard" || path === "/admin") return "portal"
    if (path.startsWith("/events/")) return "event"
    return "home"
  }

  return (
    <div className="abatable-app-shell">
      {/* Abatable Initial Intro Reveal Preloader */}
      {showPreloader && (
        <div
          className="abatable-preloader"
          aria-hidden="true"
          onClick={() => setShowPreloader(false)}
        >
          <div className="abatable-preloader-backdrop" />
          <div className="abatable-preloader-content">
            <div className="preloader-brand-block">
              <span className="preloader-title preloader-title--dept">
                <span className="preloader-dept-line preloader-dept-lead">DEPARTMENT OF</span>
                <span className="preloader-dept-line">COMPUTER SCIENCE</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Synchronous Route Transition Stage (Barba.js sync: true style) */}
      <div className="abatable-transition-stage">
        {/* Outgoing Page Layer */}
        {prevOutlet && (
          <div
            className="abatable-page-leave"
            data-theme={getPageTheme(prevOutlet.key)}
            key={`leave-${prevOutlet.key}-${transitionCounter}`}
            aria-hidden="true"
          >
            <div className="abatable-leave-scrim" />
            <div
              className="abatable-page-content"
              style={{
                transform: `translateY(-${prevOutlet.scrollOffset}px)`,
              }}
            >
              {prevOutlet.node}
            </div>
          </div>
        )}

        {/* Incoming / Active Page Layer */}
        <div
          className={`abatable-page-enter ${
            isTransitioning ? "abatable-page-enter--animating" : "abatable-page-enter--static"
          }`}
          data-theme={getPageTheme(currentOutlet.key)}
          key={`enter-${currentOutlet.key}-${transitionCounter}`}
        >
          <div className="abatable-page-content">{currentOutlet.node}</div>
        </div>
      </div>
    </div>
  )
}
