import { useState } from "react"
import { HACKATHON_PAGES, HACKATHON_PER_HEAD, HACKATHON_SIZES } from "../paymentLinks"
import type { FestivalEvent } from "../events"

interface Props {
  event: FestivalEvent
  isOpen: boolean
  onClose: () => void
}

export default function RegistrationModal({ event, isOpen, onClose }: Props) {
  const isHackathon = event.slug === "hackathon"
  const [teamSize, setTeamSize] = useState<number>(HACKATHON_SIZES[0])

  if (!isOpen) return null

  const total = teamSize * HACKATHON_PER_HEAD
  const link = HACKATHON_PAGES[teamSize]

  return (
    <div className="registration-modal-backdrop" onClick={onClose}>
      <div
        className="registration-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ "--accent": event.accent } as React.CSSProperties}
      >
        <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
          ✕
        </button>

        <div className="registration-form-view">
          <div className="modal-header">
            <p className="eyebrow">Registration · {event.number}</p>
            <h2>{event.name}</h2>
            <p className="modal-event-meta">
              {event.duration} · {event.date} · {event.format}
            </p>
          </div>

          {!isHackathon ? (
            <div className="modal-error-banner" style={{ borderColor: "#f4c97a", color: "#f4c97a" }}>
              Registration for this event opens soon.
            </div>
          ) : (
            <>
              <div className="form-field">
                <label>Select Team Size *</label>
                <div
                  className="team-size-selector"
                  style={{ gridTemplateColumns: `repeat(${HACKATHON_SIZES.length}, 1fr)` }}
                >
                  {HACKATHON_SIZES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`size-tab ${teamSize === n ? "size-tab--active" : ""}`}
                      onClick={() => setTeamSize(n)}
                    >
                      <strong>{n} Members</strong>
                      <span>
                        ₹{n * HACKATHON_PER_HEAD} (₹{HACKATHON_PER_HEAD}/head)
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="order-summary-box">
                <div className="order-row">
                  <span>
                    {event.name} ({teamSize} Members × ₹{HACKATHON_PER_HEAD})
                  </span>
                  <span>₹{total}</span>
                </div>
                <div className="receipt-divider" />
                <div className="order-row order-total">
                  <span>Total Payable:</span>
                  <strong className="total-highlight">₹{total}</strong>
                </div>
              </div>

              <div className="modal-actions">
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pill-button pill-button--gold pill-button--full"
                    style={{ textAlign: "center", textDecoration: "none" }}
                  >
                    Continue to pay ₹{total} on Razorpay ↗
                  </a>
                ) : (
                  <button type="button" disabled className="pill-button pill-button--gold pill-button--full">
                    Payment link not set yet
                  </button>
                )}
                <p className="payment-security-note">
                  🔒 Secured by Razorpay. You&apos;ll enter your team and member details on the next page,
                  and a receipt is emailed to you.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
