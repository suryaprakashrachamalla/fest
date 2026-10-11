import { Link } from "react-router"
import { publicUrl } from "../publicUrl"

export default function Header({ light = false }: { light?: boolean }) {
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
    </header>
  )
}
