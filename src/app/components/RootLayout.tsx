import { useEffect, useRef, useState } from "react"
import { useLocation, useOutlet } from "react-router"

interface OutletRecord {
  key: string
  node: React.ReactNode
  scrollOffset: number
}

function AlgorithmicGraph() {
  return (
    <div className="math-graph-wrapper" aria-label="n! >>> n algorithmic transition graph">
      <div className="math-graph-badge">
        <span className="math-formula-text">n! &gt;&gt;&gt; n</span>
        <span className="math-formula-sub">ALGORITHMIC TRANSITION</span>
      </div>
      <svg
        viewBox="0 0 370 230"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="math-graph-svg"
      >
        <defs>
          <marker
            id="axis-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#ffffff" />
          </marker>
          <filter id="cyan-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Coordinate Axes */}
        <line
          x1="50"
          y1="215"
          x2="50"
          y2="15"
          stroke="#ffffff"
          strokeWidth="2.5"
          markerEnd="url(#axis-arrow)"
          className="graph-axis-y"
        />
        <line
          x1="35"
          y1="195"
          x2="355"
          y2="195"
          stroke="#ffffff"
          strokeWidth="2.5"
          markerEnd="url(#axis-arrow)"
          className="graph-axis-x"
        />

        {/* Linear Rays (Magenta) */}
        {/* Ray 2n */}
        <line
          x1="50"
          y1="195"
          x2="280"
          y2="55"
          stroke="#e03cd9"
          strokeWidth="2.8"
          strokeLinecap="round"
          className="graph-ray graph-ray--2n"
        />
        <text
          x="288"
          y="50"
          fill="#e03cd9"
          fontFamily="'DM Mono', monospace"
          fontSize="20"
          fontWeight="700"
          className="graph-label"
        >
          2n
        </text>

        {/* Ray n */}
        <line
          x1="50"
          y1="195"
          x2="300"
          y2="108"
          stroke="#e03cd9"
          strokeWidth="2.8"
          strokeLinecap="round"
          className="graph-ray graph-ray--n"
        />
        <text
          x="308"
          y="108"
          fill="#e03cd9"
          fontFamily="'DM Mono', monospace"
          fontSize="20"
          fontWeight="700"
          className="graph-label"
        >
          n
        </text>

        {/* Ray n/2 */}
        <line
          x1="50"
          y1="195"
          x2="315"
          y2="150"
          stroke="#e03cd9"
          strokeWidth="2.8"
          strokeLinecap="round"
          className="graph-ray graph-ray--nhalf"
        />
        <g className="graph-fraction-group">
          <text
            x="323"
            y="141"
            fill="#e03cd9"
            fontFamily="'DM Mono', monospace"
            fontSize="16"
            fontWeight="700"
          >
            n
          </text>
          <line x1="322" y1="145" x2="333" y2="145" stroke="#e03cd9" strokeWidth="1.5" />
          <text
            x="324"
            y="159"
            fill="#e03cd9"
            fontFamily="'DM Mono', monospace"
            fontSize="16"
            fontWeight="700"
          >
            2
          </text>
        </g>

        {/* Exponential/Factorial Curve (Cyan) */}
        <path
          d="M 50 195 C 53 190, 60 110, 68 20"
          stroke="#00ffff"
          strokeWidth="3.6"
          strokeLinecap="round"
          filter="url(#cyan-glow)"
          className="graph-curve-fact"
        />
        <text
          x="78"
          y="35"
          fill="#00ffff"
          fontFamily="'DM Mono', monospace"
          fontSize="24"
          fontWeight="700"
          filter="url(#cyan-glow)"
          className="graph-label-fact"
        >
          n!
        </text>
      </svg>
    </div>
  )
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
  const [showPreloader, setShowPreloader] = useState(true)
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

    // Strip any lingering hash from previous session
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname)
    }

    // Force top scroll immediately
    window.scrollTo(0, 0)

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

      const href = target.getAttribute("href")
      if (!href) return

      if (href.startsWith("/#") && location.pathname === "/") {
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
  }, [location.pathname])

  const getPageTheme = (path: string) => {
    if (path === "/login" || path === "/signup") return "portal"
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
              <span className="preloader-title">SHOURYA &apos;26</span>
              <span className="preloader-sub">TECH FEST @MVSR</span>
            </div>
            <AlgorithmicGraph />
            <div className="preloader-status-bar">
              <span className="status-label">INITIALIZING ARENA • EXPONENTIAL VELOCITY</span>
              <div className="status-track">
                <div className="status-fill" />
              </div>
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
          {isTransitioning && (
            <div className="abatable-sheet-hud" aria-hidden="true">
              <div className="abatable-sheet-hud-inner">
                <span className="hud-pulse-dot" />
                <span className="hud-brand">SHOURYA &apos;26</span>
                <span className="hud-divider">/</span>
                <span className="hud-curve">n! ACCELERATION</span>
              </div>
            </div>
          )}
          <div className="abatable-page-content">{currentOutlet.node}</div>
        </div>
      </div>
    </div>
  )
}
