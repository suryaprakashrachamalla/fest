import { FormEvent, useEffect, useState } from "react"
import { Link } from "react-router"
import {
  ApiError,
  type BackendEvent,
  type Registration,
  PARTICIPANT_STATUS_LABELS,
  registrationTitle,
  checkTeamCode,
  createRegistration,
  feeFor,
  tierFor,
  findEventBySlug,
  getStoredUser,
  myRegistrations,
  paymentQrUrl,
  rupees,
  signIn,
  signUp,
  submitPaymentProof,
} from "../api"
import type { FestivalEvent } from "../events"

interface Props {
  event: FestivalEvent
  isOpen: boolean
  onClose: () => void
}

type Step = "loading" | "unavailable" | "auth" | "form" | "existing" | "done"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MVSR_ROLL = /^2451-2\d-\d{3}-\d{3}$/
const MAX_PROOF_BYTES = 5 * 1024 * 1024

// Name stored for teams that pick the MVSR option; the backend requires roll numbers for MVSR teams.
const MVSR_COLLEGE = "MVSR Engineering College"

function isMvsr(college: string) {
  return college.toLowerCase().replace(/[^a-z0-9]/g, "").includes("mvsr")
}

function validPhone(value: string) {
  return /^[6-9]\d{9}$/.test(value.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
}

export default function RegistrationModal({ event, isOpen, onClose }: Props) {
  const [step, setStep] = useState<Step>("loading")
  const [notice, setNotice] = useState("")
  const [backendEvent, setBackendEvent] = useState<BackendEvent | null>(null)
  const [existing, setExisting] = useState<Registration | null>(null)
  const [qr, setQr] = useState<{ url: string; isDemo: boolean } | null>(null)

  // Account
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup")
  const [accountName, setAccountName] = useState("")
  const [accountEmail, setAccountEmail] = useState("")
  const [password, setPassword] = useState("")

  // Team
  const [teamName, setTeamName] = useState("")
  // MVSR teams give each member's roll number; other colleges type their college name instead.
  const [collegeType, setCollegeType] = useState<"" | "mvsr" | "other">("")
  const [college, setCollege] = useState("")
  const mvsrTeam = collegeType === "mvsr"
  const collegeName = mvsrTeam ? MVSR_COLLEGE : college.trim()
  const [teamSize, setTeamSize] = useState(0)
  // Team code (₹50 off) for the events that offer them: checked with the server before it counts.
  const [teamCodeInput, setTeamCodeInput] = useState("")
  const [appliedCode, setAppliedCode] = useState<{ code: string; discountPaise: number } | null>(null)
  const [teamCodeNote, setTeamCodeNote] = useState("")
  const [checkingCode, setCheckingCode] = useState(false)
  const [students, setStudents] = useState(
    Array.from({ length: 5 }, () => ({ name: "", email: "", rollNumber: "" })),
  )
  const [phone, setPhone] = useState("")

  // Payment
  const [paymentMethod, setPaymentMethod] = useState("UPI")
  const [utr, setUtr] = useState("")
  const [screenshot, setScreenshot] = useState<File | null>(null)

  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ registration: Registration; proofError?: string } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    async function load() {
      setStep("loading")
      setError("")
      try {
        const found = await findEventBySlug(event.slug)
        if (cancelled) return
        if (!found) {
          setNotice("Registration for this event opens soon.")
          setStep("unavailable")
          return
        }
        setBackendEvent(found)
        setTeamSize((size) => (size >= found.minTeamSize && size <= found.maxTeamSize ? size : found.minTeamSize))
        paymentQrUrl().then((value) => !cancelled && setQr(value))
        await showFormOrExisting(found)
      } catch (err) {
        if (cancelled) return
        setNotice(err instanceof ApiError ? err.message : "Registration is unavailable right now.")
        setStep("unavailable")
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, event.slug])

  async function showFormOrExisting(found: BackendEvent) {
    if (!getStoredUser()) {
      setStep("auth")
      return
    }
    try {
      const mine = await myRegistrations()
      const match = mine.find((registration) => registration.event.id === found.id)
      if (match) {
        setExisting(match)
        setStep("existing")
        return
      }
      setStep("form")
    } catch (err) {
      // An expired session is cleared by the API client; ask the user to sign in again.
      setStep(err instanceof ApiError && err.status === 401 ? "auth" : "form")
    }
  }

  if (!isOpen) return null

  async function handleAuth(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (authMode === "signup" && accountName.trim().length < 2) return setError("Enter your full name.")
    if (!EMAIL_PATTERN.test(accountEmail.trim())) return setError("Enter a valid email address.")
    if (password.length < 10) return setError("Password must be at least 10 characters.")
    setBusy(true)
    try {
      if (authMode === "signup") await signUp(accountName.trim(), accountEmail.trim(), password)
      else await signIn(accountEmail.trim(), password)
      setPassword("")
      if (backendEvent) await showFormOrExisting(backendEvent)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in.")
    } finally {
      setBusy(false)
    }
  }

  function updateStudent(index: number, field: "name" | "email" | "rollNumber", value: string) {
    setStudents((current) => current.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  function validateForm() {
    if (!individual && teamName.trim().length < 2) return "Enter your team name."
    if (!collegeType) return "Choose your college: MVSR or Other college."
    if (!mvsrTeam && college.trim().length < 2) return "Enter your college name."
    if (!mvsrTeam && isMvsr(college)) return "You're from MVSR: choose the MVSR option above so each member can add their roll number."
    const team = students.slice(0, teamSize)
    for (let i = 0; i < team.length; i++) {
      if (team[i].name.trim().length < 2) return `Enter Student ${i + 1}'s name.`
      if (!EMAIL_PATTERN.test(team[i].email.trim())) return `Enter a valid email for Student ${i + 1}.`
      if (mvsrTeam && !MVSR_ROLL.test(team[i].rollNumber.trim()))
        return `Enter Student ${i + 1}'s MVSR roll number in the format 2451-2X-XXX-XXX.`
    }
    const emails = team.map((s) => s.email.trim().toLowerCase())
    if (new Set(emails).size !== emails.length) return "Each student needs a different email address."
    if (!validPhone(phone)) return "Enter a valid 10-digit mobile number."
    if (!/^[A-Za-z0-9-]{6,32}$/.test(utr.trim())) return "Enter the UTR / transaction reference (6–32 letters or numbers)."
    if (teamCodeInput.trim() && !appliedCode) return "Tap Apply to use your team code, or clear the team code box."
    if (!screenshot) return "Upload a screenshot of your payment."
    if (!["image/png", "image/jpeg"].includes(screenshot.type)) return "The payment screenshot must be a PNG or JPG image."
    if (screenshot.size > MAX_PROOF_BYTES) return "The payment screenshot must be 5 MB or smaller."
    return ""
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    if (!backendEvent) return
    const problem = validateForm()
    if (problem) return setError(problem)
    setError("")
    setBusy(true)
    let registration: Registration
    try {
      registration = await createRegistration(backendEvent.id, {
        // Individual events (workshops, shows) register one person without a team name.
        ...(individual ? {} : { teamName: teamName.trim() }),
        college: collegeName,
        phone: phone.trim(),
        participants: students.slice(0, teamSize).map((s) => ({
          name: s.name.trim(),
          email: s.email.trim(),
          ...(mvsrTeam ? { rollNumber: s.rollNumber.trim() } : {}),
        })),
        ...(appliedCode ? { teamCode: appliedCode.code } : {}),
      })
    } catch (err) {
      // e.g. another team used the code a moment ago: drop the discount so the total is right again.
      if (err instanceof Error && /team code/i.test(err.message)) setAppliedCode(null)
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.")
      setBusy(false)
      return
    }
    // The registration is saved at this point; a failed upload can be retried from the dashboard.
    try {
      await submitPaymentProof(registration.id, utr.trim(), paymentMethod, screenshot!)
      setResult({ registration: { ...registration, status: "PAYMENT_REVIEW" } })
    } catch (err) {
      setResult({
        registration,
        proofError: err instanceof Error ? err.message : "The payment proof couldn't be uploaded.",
      })
    } finally {
      setBusy(false)
      setStep("done")
    }
  }

  const fee = backendEvent ? feeFor(backendEvent, teamSize) : 0
  const discount = appliedCode ? Math.min(appliedCode.discountPaise, fee) : 0
  // What the team pays: the server computes the same amount and stores it.
  const total = fee - discount

  async function applyTeamCode() {
    if (!backendEvent || !teamCodeInput.trim()) return
    setCheckingCode(true)
    setTeamCodeNote("")
    try {
      setAppliedCode(await checkTeamCode(backendEvent.id, teamCodeInput.trim()))
    } catch (err) {
      setAppliedCode(null)
      setTeamCodeNote(err instanceof Error ? err.message : "Couldn't check the team code.")
    } finally {
      setCheckingCode(false)
    }
  }
  // One person per registration: no team name or team size to choose.
  // Events with ticket options (Single / Group of 5) offer just those sizes; the single ticket has no team.
  const tiers = backendEvent?.feeTiers?.length ? backendEvent.feeTiers : null
  const individual = backendEvent?.maxTeamSize === 1 || (tiers !== null && teamSize === 1)
  const sizes = tiers
    ? tiers.map((tier) => tier.size)
    : backendEvent
    ? Array.from({ length: backendEvent.maxTeamSize - backendEvent.minTeamSize + 1 }, (_, i) => backendEvent.minTeamSize + i)
    : []
  const user = getStoredUser()

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

          {step === "loading" && <p className="payment-security-note">Loading registration…</p>}

          {step === "unavailable" && (
            <div className="modal-error-banner modal-notice-banner">
              {notice}
            </div>
          )}

          {step === "auth" && (
            <form onSubmit={handleAuth} noValidate>
              <div className="team-size-selector" style={{ marginBottom: 18 }}>
                {(["signup", "signin"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`size-tab ${authMode === mode ? "size-tab--active" : ""}`}
                    onClick={() => {
                      setAuthMode(mode)
                      setError("")
                    }}
                  >
                    <strong>{mode === "signup" ? "Create account" : "Sign in"}</strong>
                    <span>{mode === "signup" ? "First time here" : "Already registered before"}</span>
                  </button>
                ))}
              </div>
              <p className="payment-security-note" style={{ textAlign: "left", marginBottom: 14 }}>
                Your account keeps your registration and lets you track its status on your dashboard.
              </p>
              {error && <div className="modal-error-banner">{error}</div>}
              <div className="form-grid-2">
                {authMode === "signup" && (
                  <div className="form-field">
                    <label htmlFor="acc-name">Full name *</label>
                    <input id="acc-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} autoComplete="name" />
                  </div>
                )}
                <div className="form-field">
                  <label htmlFor="acc-email">Email *</label>
                  <input id="acc-email" type="email" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} autoComplete="email" />
                </div>
                <div className="form-field">
                  <label htmlFor="acc-pass">Password * (min 10 characters)</label>
                  <input
                    id="acc-pass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: 22 }}>
                <button type="submit" className="pill-button pill-button--gold pill-button--full" disabled={busy}>
                  {busy ? "Please wait…" : authMode === "signup" ? "Create account & continue" : "Sign in & continue"}
                </button>
              </div>
            </form>
          )}

          {step === "existing" && existing && (
            <div className="registration-success-view">
              <p className="success-subtitle">You&apos;re already registered for this event.</p>
              <div className="success-receipt-box">
                <div className="receipt-row">
                  <span>Registration ID</span>
                  <strong className="receipt-pid">{existing.code}</strong>
                </div>
                <div className="receipt-row">
                  <span>{existing.teamName ? "Team" : "Participant"}</span>
                  <strong>{registrationTitle(existing)}</strong>
                </div>
                <div className="receipt-row">
                  <span>Status</span>
                  <strong>{PARTICIPANT_STATUS_LABELS[existing.status]}</strong>
                </div>
              </div>
              <div className="modal-action-buttons">
                <Link to="/dashboard" className="pill-button pill-button--gold" onClick={onClose}>
                  Open my registrations ↗
                </Link>
              </div>
            </div>
          )}

          {step === "form" && backendEvent && (
            <form onSubmit={handleRegister} noValidate>
              {user && (
                <p className="payment-security-note" style={{ textAlign: "left", marginTop: 0 }}>
                  Signed in as {user.email}
                </p>
              )}

              <p className="form-section-title">{individual ? "Registration details" : "Team details"}</p>
              <div className="form-grid-2">
                {!individual && (
                  <div className="form-field">
                    <label htmlFor="team-name">Team name *</label>
                    <input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={100} />
                  </div>
                )}
                <div className="form-field">
                  <label htmlFor="event-name">Event</label>
                  <input id="event-name" value={backendEvent.name} readOnly />
                </div>
                <div className="form-field">
                  <label htmlFor="phone">Phone number *</label>
                  <input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
                </div>
              </div>

              <p className="form-section-title">College *</p>
              <div className="team-size-selector" role="radiogroup" aria-label="College" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mvsrTeam}
                  className={`size-tab ${mvsrTeam ? "size-tab--active" : ""}`}
                  onClick={() => setCollegeType("mvsr")}
                >
                  <strong>MVSR</strong>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={collegeType === "other"}
                  className={`size-tab ${collegeType === "other" ? "size-tab--active" : ""}`}
                  onClick={() => setCollegeType("other")}
                >
                  <strong>Other college</strong>
                </button>
              </div>
              {collegeType === "other" && (
                <div className="form-field" style={{ marginTop: 14 }}>
                  <label htmlFor="college">College name *</label>
                  <input id="college" value={college} onChange={(e) => setCollege(e.target.value)} maxLength={150} placeholder="Your college's full name" />
                </div>
              )}

              {sizes.length > 1 && (
                <>
                  <p className="form-section-title">{tiers ? "Ticket" : "Team size"}</p>
                  <div className="team-size-selector" style={{ gridTemplateColumns: `repeat(${sizes.length}, 1fr)` }}>
                    {sizes.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`size-tab ${teamSize === n ? "size-tab--active" : ""}`}
                        onClick={() => setTeamSize(n)}
                      >
                        <strong>{tiers ? tierFor(backendEvent, n)?.label : `${n} Members`}</strong>
                        <span>{rupees(feeFor(backendEvent, n))}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {students.slice(0, teamSize).map((student, i) => (
                <div key={i}>
                  <p className="form-section-title">Student {i + 1}</p>
                  <div className={mvsrTeam ? "form-grid-3" : "form-grid-2"}>
                    <div className="form-field">
                      <label htmlFor={`s${i}-name`}>Name *</label>
                      <input id={`s${i}-name`} value={student.name} onChange={(e) => updateStudent(i, "name", e.target.value)} maxLength={100} />
                    </div>
                    <div className="form-field">
                      <label htmlFor={`s${i}-email`}>Email *</label>
                      <input id={`s${i}-email`} type="email" value={student.email} onChange={(e) => updateStudent(i, "email", e.target.value)} />
                    </div>
                    {mvsrTeam && (
                      <div className="form-field">
                        <label htmlFor={`s${i}-roll`}>Roll number *</label>
                        <input
                          id={`s${i}-roll`}
                          value={student.rollNumber}
                          onChange={(e) => updateStudent(i, "rollNumber", e.target.value)}
                          placeholder="2451-2X-XXX-XXX"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {event.teamCodes && (
                <div className="form-field team-code-field">
                  <label htmlFor="team-code">Team code (optional)</label>
                  <div className="team-code-row">
                    <input
                      id="team-code"
                      value={teamCodeInput}
                      onChange={(e) => {
                        setTeamCodeInput(e.target.value)
                        setAppliedCode(null)
                        setTeamCodeNote("")
                      }}
                      maxLength={20}
                      autoCapitalize="characters"
                      aria-describedby="team-code-note"
                    />
                    <button type="button" className="pill-button pill-button--outline" onClick={() => void applyTeamCode()} disabled={checkingCode || !teamCodeInput.trim()}>
                      {checkingCode ? "Checking…" : "Apply"}
                    </button>
                  </div>
                  <p id="team-code-note" className={appliedCode ? "team-code-ok" : "team-code-error"} role={teamCodeNote ? "alert" : undefined}>
                    {appliedCode ? `✓ ${appliedCode.code} applied: ${rupees(discount)} off` : teamCodeNote}
                  </p>
                </div>
              )}

              <div className="order-summary-box">
                <div className="order-row">
                  <span>
                    {backendEvent.name}
                    {tierFor(backendEvent, teamSize)
                      ? ` (${tierFor(backendEvent, teamSize)!.label}${teamSize > 1 ? `, ${teamSize} people` : ""})`
                      : backendEvent.feeMode === "PER_HEAD"
                        ? ` (${teamSize} × ${rupees(backendEvent.feePaise)})`
                        : ""}
                  </span>
                  <span>{rupees(fee)}</span>
                </div>
                {appliedCode && (
                  <div className="order-row">
                    <span>Team code {appliedCode.code}</span>
                    <span>−{rupees(discount)}</span>
                  </div>
                )}
                <div className="receipt-divider" />
                <div className="order-row order-total">
                  <span>Registration fee:</span>
                  <strong className="total-highlight">{rupees(total)}</strong>
                </div>
              </div>

              <p className="form-section-title">Payment</p>
              <div className="payment-qr-box">
                {qr ? <img src={qr.url} alt="UPI payment QR code" /> : <div className="payment-qr-placeholder" />}
                <div>
                  <p>
                    Scan with any UPI app and pay exactly <strong>{rupees(total)}</strong>.
                  </p>
                  {qr?.isDemo && <p className="payment-qr-demo">Demo QR: online payments aren&apos;t live yet. Don&apos;t pay with this code.</p>}
                  <p>Then enter the UTR / transaction ID from your payment app and upload the payment screenshot below.</p>
                </div>
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <label htmlFor="pay-method">Payment method *</label>
                  <select id="pay-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="UPI">UPI</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="utr">UTR / transaction reference *</label>
                  <input id="utr" value={utr} onChange={(e) => setUtr(e.target.value)} maxLength={32} placeholder="e.g. 412345678901" />
                </div>
              </div>
              <div className="form-field" style={{ marginTop: 14 }}>
                <label htmlFor="proof">Payment screenshot * (PNG or JPG, max 5 MB)</label>
                <input id="proof" type="file" accept="image/png,image/jpeg" onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)} />
              </div>

              {error && (
                <div className="modal-error-banner" style={{ marginTop: 18 }}>
                  {error}
                </div>
              )}
              <div className="modal-actions" style={{ marginTop: 20 }}>
                <button type="submit" className="pill-button pill-button--gold pill-button--full" disabled={busy}>
                  {busy ? "Submitting…" : `Submit registration · ${rupees(total)}`}
                </button>
                <p className="payment-security-note">
                  Organizers verify every payment manually before approving your registration.
                </p>
              </div>
            </form>
          )}

          {step === "done" && result && (
            <div className="registration-success-view">
              <div className="success-badge-icon">✓</div>
              <h2>Registration received</h2>
              <p className="success-subtitle">
                {result.proofError
                  ? "Your team is registered, but the payment proof didn't upload. Upload it from your dashboard."
                  : "We've received your payment details. Your registration is waiting for approval; once it's approved, every team member gets their entry QR by email."}
              </p>
              {result.proofError && <div className="modal-error-banner">{result.proofError}</div>}
              <div className="success-receipt-box">
                <div className="receipt-row">
                  <span>Registration ID</span>
                  <strong className="receipt-pid">{result.registration.code}</strong>
                </div>
                <div className="receipt-row">
                  <span>{result.registration.teamName ? "Team" : "Participant"}</span>
                  <strong>{registrationTitle(result.registration)}</strong>
                </div>
                <div className="receipt-row">
                  <span>Status</span>
                  <strong>{PARTICIPANT_STATUS_LABELS[result.registration.status]}</strong>
                </div>
                <div className="receipt-row">
                  <span>Amount</span>
                  <strong className="receipt-amount">{rupees(result.registration.amountPaise)}</strong>
                </div>
              </div>
              <div className="modal-action-buttons">
                <Link to="/dashboard" className="pill-button pill-button--gold" onClick={onClose}>
                  Open my registrations ↗
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
