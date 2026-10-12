import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router"
import { getStoredUser } from "../api"
import { publicUrl } from "../publicUrl"
import { ADMIN_PATH } from "../adminPath"

// Home page sections; category ids match the category headings on the home page.
const sectionLinks = [
  ["TECHNICAL", "technical"],
  ["SEMI-TECHNICAL", "semi-technical"],
  ["CULTURAL", "cultural"],
  ["FUN EVENTS", "fun"],
  ["GALLERY", "gallery"],
  ["FAQ", "faq"],
  ["INFO", "info"],
  ["CONTACT", "contact"],
] as const

export default function Header({ light = false }: { light?: boolean }) {
  // Re-read on every navigation so the links switch right after logging in or out.
  const location = useLocation()
  const user = getStoredUser()
  // Phones show the links in a menu opened from the header.
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [location.pathname, location.state])

  const accountLinks =
    user?.role === "ADMIN" ? (
      <Link to={ADMIN_PATH}>ADMIN</Link>
    ) : user ? (
      <Link to="/dashboard">DASHBOARD</Link>
    ) : (
      <>
        <Link to="/login">LOG IN</Link>
        <Link to="/signup">SIGN UP</Link>
      </>
    )

  return (
    <header className={`site-header ${light ? "site-header--light" : ""}`}>
      <Link className="brand" to="/" aria-label="Shourya Fest home">
        <span className="brand-logo-frame">
          <img src={publicUrl("/shourya-logo-gold.png")} alt="Shourya" />
        </span>
      </Link>

      <nav className="main-nav" aria-label="Main navigation">
        {sectionLinks.map(([label, id]) => (
          <a key={id} href={publicUrl(`/#${id}`)}>
            {label}
          </a>
        ))}
      </nav>

      <nav className="account-nav" aria-label="Account">
        {accountLinks}
      </nav>

      <button
        type="button"
        className="menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="site-menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? "CLOSE" : "MENU"}
      </button>
      {menuOpen && (
        <nav id="site-menu" className="mobile-menu" aria-label="Menu" onClick={(e) => (e.target as HTMLElement).closest("a") && setMenuOpen(false)}>
          {sectionLinks.map(([label, id]) => (
            <a key={id} href={publicUrl(`/#${id}`)}>
              {label}
            </a>
          ))}
          <div className="mobile-menu-account">{accountLinks}</div>
        </nav>
      )}
    </header>
  )
}
