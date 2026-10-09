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
        <a href="/#technical">TECHNICAL</a>
        <a href="/#semi-technical">SEMI-TECHNICAL</a>
        <a href="/#cultural">CULTURAL</a>
        <a href="/#faq">FAQ</a>
        <a href="/#info">INFO</a>
        <a href="/#contact">CONTACT</a>
      </nav>

      <div className="auth-actions">

        <Link className="pill-link pill-link--login" to="/login">
          LOG IN
        </Link>
        <Link className="pill-link" to="/signup">
          SIGN UP <span>↗</span>
        </Link>
      </div>
    </header>
  )
}
