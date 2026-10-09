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
        <div className="torn-paper-edge" aria-hidden="true">
          <svg
            viewBox="0 0 1200 40"
            preserveAspectRatio="none"
            className="torn-paper-svg"
          >
            <path
              d="M0,0 L1200,0 L1200,18 L1185,25 L1170,18 L1155,27 L1140,19 L1125,26 L1110,18 L1095,24 L1080,19 L1065,28 L1050,18 L1035,24 L1020,17 L1005,25 L990,19 L975,27 L960,18 L945,24 L930,19 L915,26 L900,17 L885,24 L870,19 L855,28 L840,18 L825,26 L810,17 L795,24 L780,19 L765,27 L750,18 L735,25 L720,19 L705,28 L690,18 L675,25 L660,19 L645,27 L630,18 L615,24 L600,19 L585,28 L570,18 L555,26 L540,17 L525,25 L510,19 L495,27 L480,18 L465,25 L450,19 L435,28 L420,18 L405,25 L390,19 L375,27 L360,18 L345,24 L330,19 L315,28 L300,18 L285,26 L270,17 L255,25 L240,19 L225,27 L210,18 L195,25 L180,19 L165,28 L150,18 L135,25 L120,19 L105,27 L90,18 L75,25 L60,19 L45,28 L30,18 L15,25 L0,18 Z"
              fill="#ffffff"
              opacity="0.5"
            />
            <path
              d="M0,0 L1200,0 L1200,12 L1180,18 L1160,11 L1140,20 L1120,13 L1100,19 L1080,12 L1060,21 L1040,12 L1020,18 L1000,11 L980,19 L960,13 L940,20 L920,12 L900,18 L880,13 L860,21 L840,12 L820,19 L800,12 L780,18 L760,12 L740,20 L720,12 L700,18 L680,13 L660,20 L640,12 L620,18 L600,13 L580,21 L560,12 L540,19 L520,12 L500,18 L480,12 L460,20 L440,12 L420,18 L400,13 L380,20 L360,12 L340,18 L320,13 L300,21 L280,12 L260,19 L240,12 L220,18 L200,12 L180,20 L160,12 L140,18 L120,13 L100,20 L80,12 L60,18 L40,13 L20,21 L0,12 Z"
              fill="#ffffff"
            />
          </svg>
        </div>

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
                <a href="mailto:shourya@mvsrec.edu.in" className="contact-email-address">
                  shourya@mvsrec.edu.in
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
