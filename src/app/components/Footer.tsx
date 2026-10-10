import { Link } from "react-router"

const details = [
  {
    label: "Campus address",
    value: "MVSR Engineering College",
    meta: "Nadergul, Hyderabad",
    href: "https://www.google.com/maps/search/?api=1&query=MVSR+Engineering+College+Nadergul+Hyderabad",
  },
  {
    label: "Registration desk",
    value: "Entrance Gate",
    meta: "Shourya help desk",
    href: null,
  },
  {
    label: "Fest hours",
    value: "09:30 AM — 06:30 PM",
    meta: "October 16 & 17 · Both days",
    href: null,
  },
]

const faqs = [
  {
    question: "Who can participate in Shourya’26?",
    answer:
      "Shourya is open to eligible college students. Keep your current college ID ready when you arrive at the registration desk.",
  },
  {
    question: "When do registrations open?",
    answer:
      "Registrations open on October 10. The live countdown on the homepage will disappear automatically once registration begins.",
  },
  {
    question: "Can I register for more than one event?",
    answer:
      "Yes, you can join multiple events as long as their schedules do not overlap. Check each event page for its exact date and time.",
  },
  {
    question: "Where will the events take place?",
    answer:
      "All events will be held at MVSR Engineering College, Nadergul, Hyderabad. Venue-specific directions will be available at the Main Block help desk.",
  },
  {
    question: "Do team events require every member to register?",
    answer:
      "No. Only one team member needs to register on behalf of the team and provide the complete details of every participating member.",
  },
  {
    question: "Is food provided for the 24-hour Hackathon?",
    answer:
      "Yes. Food will be provided to registered Hackathon participants throughout the 24-hour event, and there is no additional fee for it.",
  },
]

export default function Footer() {
  return (
    <footer className="footer">
      <section id="contact" className="contact-banner">
        <div className="contact-banner-inner">
          <h2 className="contact-banner-title">GET IN TOUCH</h2>
          <p className="contact-banner-subtitle">
            Have questions or need assistance? Reach out to us via our official emails.
          </p>

          <div className="contact-banner-grid">
            <div className="contact-banner-social">
              <a
                href="https://www.instagram.com/shourya_cse?obrf=MXQ3ZGg3YWRpN3ptZA=="
                target="_blank"
                rel="noreferrer"
                className="contact-social-link"
              >
                <span className="contact-social-icon-box">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="contact-instagram-icon"
                  >
                    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                  </svg>
                </span>
                <span className="contact-social-name">Instagram</span>
              </a>
            </div>

            <div className="contact-banner-divider" aria-hidden="true" />

            <div className="contact-banner-emails">
              <div className="contact-email-item">
                <span className="contact-email-tag">CORPORATE EMAIL</span>
                <a href="mailto:shourya2026@mvsrec.edu.in" className="contact-email-address">
                  shourya2026@mvsrec.edu.in
                </a>
              </div>

              <div className="contact-email-item">
                <span className="contact-email-tag">STUDENT EMAIL</span>
                <a href="mailto:245123733055@mvsrec.edu.in" className="contact-email-address">
                  245123733055@mvsrec.edu.in
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="faq-section">
        <div className="faq-heading">
          <p className="eyebrow">Before you arrive</p>
          <h2>
            Good questions.
            <br />
            <em>Clear answers.</em>
          </h2>
          <p>Everything worth knowing before you step onto campus.</p>
        </div>

        <div className="faq-list">
          {faqs.map((faq, index) => (
            <details key={faq.question}>
              <summary>
                <span>0{index + 1}</span>
                <strong>{faq.question}</strong>
                <i aria-hidden="true" />
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <div id="info" className="footer-title">
        <h2>
          Meet us at the <em>fest.</em>
        </h2>
      </div>

      <div className="footer-details">
        {details.map((detail, index) => (
          <div
            className={`footer-detail footer-detail--photo footer-detail--${["campus", "gate", "hours"][index]}`}
            key={detail.label}
          >
            <span>0{index + 1}</span>
            <p>{detail.label}</p>
            <strong>{detail.value}</strong>
            <small>{detail.meta}</small>
            {detail.href && (
              <a href={detail.href} target="_blank" rel="noreferrer">
                Get directions ↗
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="footer-bottom">
        <Link className="brand" to="/">
          SHOURYA&apos;26
        </Link>
        <p>© 2026 Shourya, MVSR Engineering College. All rights reserved.</p>
        <div>
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href="#contact">Contact</a>
        </div>
      </div>
    </footer>
  )
}
