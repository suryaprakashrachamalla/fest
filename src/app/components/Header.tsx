import { Link, useLocation } from "react-router"
import { getStoredUser } from "../api"
import { publicUrl } from "../publicUrl"

export default function Header({ light = false }: { light?: boolean }) {
  // Re-read on every navigation so the links switch right after logging in or out.
  useLocation()
  const user = getStoredUser()

  return (
    <header className={`site-header ${light ? "site-header--light" : ""}`}>
      <Link className="brand" to="/" aria-label="Shourya Fest home">
        <span className="brand-logo-frame">
          <img src={publicUrl("/shourya-logo-gold.png")} alt="Shourya" />
        </span>
        <span className="brand-year">&apos;26</span>
      </Link>

      <nav className="main-nav" aria-label="Main navigation">
        <a href={publicUrl("/#technical")}>TECHNICAL</a>
        <a href={publicUrl("/#semi-technical")}>SEMI-TECHNICAL</a>
        <a href={publicUrl("/#cultural")}>CULTURAL</a>
        <a href={publicUrl("/#gallery")}>GALLERY</a>
        <a href={publicUrl("/#faq")}>FAQ</a>
        <a href={publicUrl("/#info")}>INFO</a>
        <a href={publicUrl("/#contact")}>CONTACT</a>
      </nav>

      <nav className="account-nav" aria-label="Account">
        {user?.role === "ADMIN" ? (
          <Link to="/admin">ADMIN</Link>
        ) : user ? (
          <Link to="/dashboard">DASHBOARD</Link>
        ) : (
          <>
            <Link to="/login">LOG IN</Link>
            <Link to="/signup">SIGN UP</Link>
          </>
        )}
      </nav>
    </header>
  )
}
