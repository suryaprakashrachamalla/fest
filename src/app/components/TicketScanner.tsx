import { FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { ApiError, type TeamCheckIn, type TicketScan, STATUS_LABELS, admin } from "../api"

// Chrome on Android has a built-in QR reader; other browsers (iPhone Safari) fall back to jsQR.
type QrDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type QrDetectorClass = new (options: { formats: string[] }) => QrDetector

// What the backend said about one scan. Camera problems are shown separately (cameraError).
// "ready" is a valid, unused ticket waiting for the organizer to tap Authorize entry.
// "team" is a team found by its registration ID (typed in when a QR won't scan), with the result of
// the last "Authorize selected" if there was one.
type TeamResult = { participantId: string; name: string; outcome: "ADMITTED" | "ALREADY_ENTERED" }
type Outcome =
  | { kind: "team"; team: TeamCheckIn; results?: TeamResult[] }
  | { kind: "ready"; scan: TicketScan; code: string }
  | { kind: "authorized" | "used" | "ineligible"; scan: TicketScan }
  | { kind: "invalid" | "network" | "session"; message: string; title?: string }

// The same QR held in front of the camera isn't sent again until it has been out of view this long.
const SAME_CODE_COOLDOWN_MS = 4000
// Short pause after each result so the next attendee can step up.
const PAUSE_AFTER_RESULT_MS = 1200

function time(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN", { timeStyle: "medium", dateStyle: "medium" }) : ""
}

function newScanId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function cameraProblem(err: unknown) {
  const name = err instanceof DOMException ? err.name : ""
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access was blocked. Allow the camera for this site in the browser settings, then tap Start scanning again. You can also type the ticket code below."
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Type the ticket code below instead."
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and tap Start scanning again."
  return "Couldn't open the camera. Type the ticket code below instead."
}

// Entrance check-in inside the signed-in admin portal. Each decoded QR is sent to the admin-only scan
// API, which checks the ticket on the server: the first valid scan authorizes entry, later scans are
// reported as already scanned. The camera keeps running so attendees can be scanned one after another.
// `initialCode` handles QR links from tickets emailed while the QR was briefly a link (/admin?ticket=...).
export default function TicketScanner({
  initialCode,
  onInitialCodeHandled,
  onSessionExpired,
}: {
  initialCode?: string | null
  onInitialCodeHandled?: () => void
  onSessionExpired?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const inFlight = useRef(false)
  const pauseUntil = useRef(0)
  const lastSeen = useRef({ text: "", at: 0 })
  const [camera, setCamera] = useState<"off" | "starting" | "on">("off")
  const [cameraError, setCameraError] = useState("")
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState("")
  // Members ticked in a team found by registration ID.
  const [selected, setSelected] = useState<string[]>([])
  const resultRef = useRef<HTMLDivElement>(null)

  // Each new result is brought into view, so volunteers on phones never have to scroll.
  useEffect(() => {
    if (outcome) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [outcome])

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera("off")
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  // A valid ticket waits here for Authorize entry; scanning pauses until it's authorized or skipped.
  const awaiting = useRef(false)

  // Sends one request to the server. Only one runs at a time; a network failure is retried once with
  // the same scan ID, so a lost response to Authorize can't turn into a false "already scanned".
  // admit=false only checks the ticket; admit=true (the Authorize button) records the entry.
  const send = useCallback(
    async (text: string, admit: boolean) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      const scanId = newScanId()
      try {
        let scan: TicketScan
        try {
          scan = await admin.scanTicket(text, admit, scanId)
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 0) throw err
          await new Promise((resolve) => setTimeout(resolve, 800))
          scan = await admin.scanTicket(text, admit, scanId)
        }
        awaiting.current = false
        // The QR is usually still in front of the camera: don't re-read it as a fresh scan.
        lastSeen.current = { text, at: Date.now() }
        if (scan.justAdmitted) setOutcome({ kind: "authorized", scan })
        else if (scan.admission === "ALREADY_ENTERED") setOutcome({ kind: "used", scan })
        else if (scan.admission === "ALLOWED") {
          awaiting.current = true
          setOutcome({ kind: "ready", scan, code: text })
        } else setOutcome({ kind: "ineligible", scan })
        navigator.vibrate?.(scan.admission === "NOT_APPROVED" || (scan.admission === "ALREADY_ENTERED" && !scan.justAdmitted) ? [80, 60, 80] : 120)
      } catch (err) {
        const status = err instanceof ApiError ? err.status : -1
        if (status === 401) {
          stopCamera()
          setOutcome({ kind: "session", message: "Your sign-in has expired. Sign in again to keep scanning." })
          onSessionExpired?.()
        } else if (status === 400 || status === 404) {
          setOutcome({ kind: "invalid", message: "This QR isn't a valid SHOURYA'26 ticket." })
        } else {
          setOutcome({
            kind: "network",
            message: "Couldn't reach the server, so this ticket was NOT checked. Check the connection and scan it again.",
          })
        }
      } finally {
        inFlight.current = false
        setBusy(false)
        pauseUntil.current = Date.now() + PAUSE_AFTER_RESULT_MS
      }
    },
    [onSessionExpired, stopCamera],
  )
  const check = useCallback((text: string) => send(text, false), [send])

  // Records the entry for the ticket on screen; Google Sheets is updated by the backend.
  function authorize() {
    if (outcome?.kind === "ready") void send(outcome.code, true)
  }

  // Leaves the pending ticket unrecorded and goes back to scanning.
  function skip() {
    if (outcome?.kind === "ready") lastSeen.current = { text: outcome.code, at: Date.now() }
    awaiting.current = false
    setOutcome(null)
  }

  // A QR link opened from a phone camera is checked once, as soon as the organizer is signed in.
  const handledInitial = useRef(false)
  useEffect(() => {
    if (!initialCode || handledInitial.current) return
    handledInitial.current = true
    void check(initialCode).finally(() => onInitialCodeHandled?.())
  }, [initialCode, check, onInitialCodeHandled])

  // Reads one video frame; returns the QR text or null.
  async function readFrame(video: HTMLVideoElement, detector: QrDetector | null, jsQR: typeof import("jsqr").default | null) {
    if (video.readyState < 2) return null
    if (detector) {
      const codes = await detector.detect(video).catch(() => [])
      return codes[0]?.rawValue ?? null
    }
    if (!jsQR) return null
    const scale = Math.min(1, 640 / (video.videoWidth || 640))
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    if (!width || !height) return null
    const canvas = (canvasRef.current ??= document.createElement("canvas"))
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return null
    context.drawImage(video, 0, 0, width, height)
    const frame = context.getImageData(0, 0, width, height)
    return jsQR(frame.data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null
  }

  async function startCamera() {
    setCameraError("")
    // A deliberate restart may re-scan the QR that was just shown.
    lastSeen.current = { text: "", at: 0 }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser can't open the camera on this page. Use the https:// site in Chrome or Safari, or type the ticket code below.")
      return
    }
    setCamera("starting")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      setCamera("on")

      let detector: QrDetector | null = null
      const Detector = (window as unknown as { BarcodeDetector?: QrDetectorClass }).BarcodeDetector
      if (Detector) {
        try {
          detector = new Detector({ formats: ["qr_code"] })
        } catch {
          detector = null
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default

      const tick = async () => {
        if (!streamRef.current) return
        const now = Date.now()
        if (!inFlight.current && !awaiting.current && now >= pauseUntil.current) {
          const text = await readFrame(video, detector, jsQR)
          const repeat = text && text === lastSeen.current.text && now - lastSeen.current.at < SAME_CODE_COOLDOWN_MS
          if (text) lastSeen.current = { text, at: now }
          if (text && !repeat) await check(text)
        }
        timerRef.current = window.setTimeout(() => void tick(), 180)
      }
      void tick()
    } catch (err) {
      stopCamera()
      setCameraError(cameraProblem(err))
    }
  }

  // Shared error handling for the registration-ID requests (no automatic retry: re-open the team instead,
  // which shows who is already in).
  function teamRequestFailed(err: unknown) {
    const status = err instanceof ApiError ? err.status : -1
    if (status === 401) {
      stopCamera()
      setOutcome({ kind: "session", message: "Your sign-in has expired. Sign in again to keep checking people in." })
      onSessionExpired?.()
    } else if (status === 400 || status === 404) {
      setOutcome({
        kind: "invalid",
        title: "REGISTRATION ID NOT FOUND",
        message: err instanceof Error ? err.message : "No registration has this ID.",
      })
    } else if (status === 409) {
      setOutcome({ kind: "invalid", title: "ENTRY DENIED", message: err instanceof Error ? err.message : "This team can't be checked in." })
    } else {
      setOutcome({ kind: "network", message: "Couldn't reach the server, so nobody was checked in. Check the connection and try again." })
    }
  }

  async function findTeam(code: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const team = await admin.lookupTeam(code)
      awaiting.current = true // camera scanning pauses while a team is open
      setSelected([])
      setOutcome({ kind: "team", team })
    } catch (err) {
      awaiting.current = false
      teamRequestFailed(err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function authorizeSelected() {
    if (outcome?.kind !== "team" || selected.length === 0 || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const { results, team } = await admin.checkInMembers(outcome.team.registration.id, selected)
      setSelected([])
      setOutcome({ kind: "team", team, results })
      navigator.vibrate?.(120)
    } catch (err) {
      awaiting.current = false
      teamRequestFailed(err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function closeTeam() {
    awaiting.current = false
    setSelected([])
    setOutcome(null)
  }

  function submitManual(e: FormEvent) {
    e.preventDefault()
    const value = manual.trim()
    if (!value) return
    // A registration ID (SG26-…) opens the whole team; anything else is treated as a ticket code.
    if (/^SG26-/i.test(value)) void findTeam(value)
    else void check(value)
  }

  const scan = outcome && "scan" in outcome ? outcome.scan : null
  const team = outcome?.kind === "team" ? outcome.team : null
  const teamApproved = team?.admission === "APPROVED"
  const notEntered = team ? team.members.filter((m) => !m.checkedInAt) : []
  const admitted = outcome?.kind === "team" ? (outcome.results ?? []).filter((r) => r.outcome === "ADMITTED") : []
  const alreadyIn = outcome?.kind === "team" ? (outcome.results ?? []).filter((r) => r.outcome === "ALREADY_ENTERED") : []
  const headline = !outcome
    ? null
    : outcome.kind === "team"
      ? !teamApproved
        ? {
            tone: "denied",
            title: "ENTRY DENIED — NOT APPROVED",
            detail: `This registration is "${STATUS_LABELS[outcome.team.registration.status]}", so its members can't enter.`,
          }
        : admitted.length
          ? {
              tone: "allowed",
              title: "ENTRY AUTHORIZED",
              detail: `Checked in: ${admitted.map((r) => r.name).join(", ")}. Give ${admitted.length} band${admitted.length === 1 ? "" : "s"}.${
                alreadyIn.length ? ` Already entered before (not authorized again): ${alreadyIn.map((r) => r.name).join(", ")}.` : ""
              }`,
            }
          : alreadyIn.length
            ? {
                tone: "denied",
                title: "ALREADY ENTERED",
                detail: `${alreadyIn.map((r) => r.name).join(", ")} entered earlier, so nobody was authorized again.`,
              }
            : {
                tone: "allowed",
                title: "TEAM FOUND",
                detail: notEntered.length
                  ? "Tick the members who are at the gate, then tap Authorize selected."
                  : "Every member of this team has already entered.",
              }
      : outcome.kind === "ready"
      ? { tone: "allowed", title: "VALID TICKET", detail: "Check the name and details, then tap Authorize entry." }
      : outcome.kind === "authorized"
      ? {
          tone: "allowed",
          title: "ENTRY AUTHORIZED",
          detail: "Check-in recorded (saved to Google Sheets in a few seconds). Give the band.",
        }
      : outcome.kind === "used"
        ? {
            tone: "denied",
            title: "INVALID TICKET — ALREADY SCANNED",
            detail: `First scanned ${time(outcome.scan.participant.checkedInAt)}${outcome.scan.participant.checkedInBy ? ` by ${outcome.scan.participant.checkedInBy}` : ""}. Don't give another band.`,
          }
        : outcome.kind === "ineligible"
          ? {
              tone: "denied",
              title: "ENTRY DENIED — NOT APPROVED",
              detail: `This registration is "${STATUS_LABELS[outcome.scan.registration.status]}", so the ticket can't be used.`,
            }
          : outcome.kind === "invalid"
            ? { tone: "denied", title: outcome.title ?? "INVALID QR CODE — ENTRY DENIED", detail: outcome.message }
            : {
                tone: "entered",
                title: outcome.kind === "session" ? "SIGN IN AGAIN" : "NETWORK ERROR — NOT CHECKED",
                detail: "message" in outcome ? outcome.message : "",
              }

  return (
    <section className="account-card ticket-scanner">
      <h2>Entrance check-in</h2>
      <p className="account-muted">
        Tap <strong>Start scanning</strong> and point the camera at the attendee&apos;s entry QR (from their email or dashboard). Check the
        details shown, then tap <strong>Authorize entry</strong> to check them in. A ticket can be authorized only once. If a QR won&apos;t
        scan, type the team&apos;s registration ID below and tick the members at the gate.
      </p>

      <div className={`ticket-camera ${camera === "off" ? "ticket-camera--off" : ""}`}>
        <video ref={videoRef} playsInline muted />
        {camera === "on" && <div className="ticket-camera-frame" aria-hidden="true" />}
        {camera === "on" && busy && <div className="ticket-camera-busy">Checking…</div>}
      </div>

      {outcome && headline && (
        <div ref={resultRef} className={`ticket-result ticket-result--${headline.tone}`} aria-live="assertive">
          <p className="ticket-verdict">{headline.title}</p>
          <p className="ticket-verdict-detail">{headline.detail}</p>
          {scan && (
            <>
              <p className="ticket-name">{scan.participant.name}</p>
              <p className="ticket-event">{scan.event.name}</p>
              <div className="success-receipt-box account-receipt">
                <div className="receipt-row"><span>Registration ID</span><strong>{scan.registration.code}</strong></div>
                <div className="receipt-row"><span>Email</span><strong>{scan.participant.email}</strong></div>
                <div className="receipt-row"><span>College</span><strong>{scan.participant.college}</strong></div>
                {scan.participant.rollNumber && (
                  <div className="receipt-row"><span>Roll number</span><strong>{scan.participant.rollNumber}</strong></div>
                )}
                <div className="receipt-row"><span>Team</span><strong>{scan.registration.teamName}</strong></div>
                <div className="receipt-row"><span>Registration</span><strong>{STATUS_LABELS[scan.registration.status]}</strong></div>
                <div className="receipt-row">
                  <span>Check-in</span>
                  <strong>
                    {scan.participant.checkedInAt
                      ? `${time(scan.participant.checkedInAt)}${scan.participant.checkedInBy ? ` · ${scan.participant.checkedInBy}` : ""}`
                      : "Not checked in"}
                  </strong>
                </div>
              </div>
              {scan.teammates.length > 1 && (
                <ul className="ticket-teammates">
                  {scan.teammates.map((member) => (
                    <li key={member.id} className={member.id === scan.participant.id ? "is-current" : ""}>
                      <span>{member.name}</span>
                      <em>{member.checkedInAt ? `entered ${time(member.checkedInAt)}` : "not entered yet"}</em>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {team && (
            <>
              <p className="ticket-name">{team.registration.teamName}</p>
              <p className="ticket-event">{team.event.name}</p>
              <div className="success-receipt-box account-receipt">
                <div className="receipt-row"><span>Registration ID</span><strong>{team.registration.code}</strong></div>
                <div className="receipt-row"><span>College</span><strong>{team.registration.college}</strong></div>
                <div className="receipt-row"><span>Registration</span><strong>{STATUS_LABELS[team.registration.status]}</strong></div>
                <div className="receipt-row">
                  <span>Entered</span>
                  <strong>{team.members.length - notEntered.length} of {team.members.length}</strong>
                </div>
              </div>
              <ul className="team-checkin-list">
                {team.members.map((member) => {
                  const done = Boolean(member.checkedInAt)
                  const ticked = selected.includes(member.id)
                  return (
                    <li key={member.id} className={done ? "is-done" : ticked ? "is-selected" : ""}>
                      <label>
                        <input
                          type="checkbox"
                          checked={done || ticked}
                          disabled={done || !teamApproved || busy}
                          onChange={(e) =>
                            setSelected((current) =>
                              e.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id),
                            )
                          }
                        />
                        <span>
                          <strong>{member.name}</strong>
                          <em>{member.rollNumber ? `${member.rollNumber} · ` : ""}{member.email}</em>
                          <em className="team-checkin-status">
                            {done ? `Entered ${time(member.checkedInAt)}${member.checkedInBy ? ` by ${member.checkedInBy}` : ""}` : "Not entered"}
                          </em>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <div className="ticket-authorize">
                {teamApproved && notEntered.length > 0 && (
                  <>
                    <button type="button" className="pill-button pill-button--gold ticket-admit" onClick={authorizeSelected} disabled={busy || selected.length === 0}>
                      {busy ? "Authorizing…" : selected.length ? `Authorize selected (${selected.length})` : "Tick members to authorize"}
                    </button>
                    {selected.length < notEntered.length && (
                      <button type="button" className="pill-button pill-button--outline" onClick={() => setSelected(notEntered.map((m) => m.id))} disabled={busy}>
                        Select everyone not entered ({notEntered.length})
                      </button>
                    )}
                  </>
                )}
                <button type="button" className="pill-button pill-button--outline" onClick={closeTeam} disabled={busy}>
                  Done
                </button>
              </div>
            </>
          )}
          {outcome.kind === "team" ? null : outcome.kind === "ready" ? (
            <div className="ticket-authorize">
              <button type="button" className="pill-button pill-button--gold ticket-admit" onClick={authorize} disabled={busy}>
                {busy ? "Authorizing…" : "Authorize entry"}
              </button>
              <button type="button" className="pill-button pill-button--outline" onClick={skip} disabled={busy}>
                Don&apos;t authorize
              </button>
            </div>
          ) : (
            camera === "on" && <p className="ticket-next">Ready for the next attendee: point the camera at their QR.</p>
          )}
        </div>
      )}

      <div className="admin-actions">
        {camera === "off" ? (
          <button type="button" className="pill-button pill-button--gold" onClick={startCamera}>
            Start scanning
          </button>
        ) : (
          <button type="button" className="pill-button pill-button--outline" onClick={stopCamera}>
            {camera === "starting" ? "Opening camera…" : "Stop camera"}
          </button>
        )}
      </div>
      {cameraError && <div className="modal-error-banner" style={{ marginTop: 14 }}>{cameraError}</div>}

      <form className="ticket-manual" onSubmit={submitManual}>
        <div className="form-field">
          <label htmlFor="ticket-code">QR not scanning? Type the registration ID (SG26-…) or the ticket code from the email</label>
          <input
            id="ticket-code"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={80}
            placeholder="SG26-XXXXXXXX"
          />
        </div>
        <button type="submit" className="pill-button pill-button--outline" disabled={busy || !manual.trim()}>
          Check
        </button>
      </form>

      {busy && camera === "off" && <p className="account-muted">Checking…</p>}

    </section>
  )
}
