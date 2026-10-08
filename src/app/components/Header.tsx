import { Link } from "react-router"

export default function Header({ light = false }: { light?: boolean }) {
  return (
    <header className={`site-header ${light ? "site-header--light" : ""}`}>
      <Link className="brand" to="/" aria-label="Shourya Fest home">
        <span className="brand-logo-frame">
          <img src="/shourya-logo.jpg" alt="Shourya" />
        </span>
        <span className="brand-year">&apos;26</span>
      </Link>

      <nav className="main-nav" aria-label="Main navigation">
        <a href="/#technical">Technical</a>
        <a href="/#semi-technical">Semi-Technical</a>
        <a href="/#cultural">Cultural</a>
        <a href="/#faq">FAQ</a>
        <a href="/#info">Info</a>
      </nav>

      <div className="auth-actions">
        <Link
          className="pill-link"
          to="/events/hackathon"
          style={{
            background: "linear-gradient(135deg, #f4c97a 0%, #e2b058 100%)",
            color: "#0a0a0a",
            fontWeight: "700",
            border: "none",
          }}
        >
          Register Now <span>↗</span>
        </Link>
      </div>
    </header>
  )
}
