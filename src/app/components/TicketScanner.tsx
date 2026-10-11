import { FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { type TicketScan, STATUS_LABELS, admin } from "../api"

// Chrome on Android has a built-in QR reader; other browsers (iPhone Safari) fall back to jsQR.
type QrDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type QrDetectorClass = new (options: { formats: string[] }) => QrDetector

function time(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN", { timeStyle: "short", dateStyle: "medium" }) : ""
}

// Entrance check-in: scan a member's entry QR, see their name and event, then record their entry.
export default function TicketScanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastCode = useRef("")
  const [camera, setCamera] = useState<"off" | "starting" | "on">("off")
  const [result, setResult] = useState<TicketScan | null>(null)
  const [justAdmitted, setJustAdmitted] = useState(false)
  const [error, setError] = useState("")
  const [manual, setManual] = useState("")
  const [busy, setBusy] = useState(false)

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera("off")
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const lookUp = useCallback(async (code: string) => {
    lastCode.current = code
    setBusy(true)
    setError("")
    setJustAdmitted(false)
    try {
      setResult(await admin.scanTicket(code))
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : "Couldn't check this ticket")
    } finally {
      setBusy(false)
    }
  }, [])

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
    setError("")
    setResult(null)
    setJustAdmitted(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here. Type the ticket code below instead.")
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
        const text = await readFrame(video, detector, jsQR)
        if (text) {
          stopCamera()
          navigator.vibrate?.(120)
          await lookUp(text)
          return
        }
        timerRef.current = window.setTimeout(() => void tick(), 180)
      }
      void tick()
    } catch (err) {
      stopCamera()
      const denied = err instanceof DOMException && err.name === "NotAllowedError"
      setError(
        denied
          ? "Camera access was blocked. Allow the camera for this site in your browser settings, or type the ticket code below."
          : "Couldn't open the camera. Type the ticket code below instead.",
      )
    }
  }

  async function admit() {
    if (!result) return
    setBusy(true)
    setError("")
    try {
      setResult(await admin.admitParticipant(result.participant.id))
      setJustAdmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record the entry")
      // Show the latest state, e.g. another volunteer admitted this person a moment ago.
      if (lastCode.current) setResult(await admin.scanTicket(lastCode.current).catch(() => result))
    } finally {
      setBusy(false)
    }
  }

  function submitManual(e: FormEvent) {
    e.preventDefault()
    if (manual.trim()) void lookUp(manual.trim())
  }

  const verdict = result
    ? justAdmitted
      ? { tone: "allowed", text: "✓ Entry recorded. Give the band." }
      : result.admission === "ALLOWED"
        ? { tone: "allowed", text: "✓ Valid ticket. Allow entry." }
        : result.admission === "ALREADY_ENTERED"
          ? {
              tone: "entered",
              text: `Already entered ${time(result.participant.checkedInAt)}${result.participant.checkedInBy ? ` (by ${result.participant.checkedInBy})` : ""}. No second band.`,
            }
          : { tone: "denied", text: `✗ Not approved (${STATUS_LABELS[result.registration.status]}). Don't allow entry.` }
    : null

  return (
    <section className="account-card ticket-scanner">
      <h2>Entrance check-in</h2>
      <p className="account-muted">
        Scan a member&apos;s entry QR (from their email or dashboard). Check the name, tap <strong>Mark entered</strong>, then give the band.
        Each QR works once.
      </p>

      <div className={`ticket-camera ${camera === "off" ? "ticket-camera--off" : ""}`}>
        <video ref={videoRef} playsInline muted />
        {camera === "on" && <div className="ticket-camera-frame" aria-hidden="true" />}
      </div>

      <div className="admin-actions">
        {camera === "off" ? (
          <button type="button" className="pill-button pill-button--gold" onClick={startCamera} disabled={busy}>
            {result || error ? "Scan next ticket" : "Start scanning"}
          </button>
        ) : (
          <button type="button" className="pill-button pill-button--outline" onClick={stopCamera}>
            {camera === "starting" ? "Opening camera…" : "Stop camera"}
          </button>
        )}
      </div>

      <form className="ticket-manual" onSubmit={submitManual}>
        <div className="form-field">
          <label htmlFor="ticket-code">Or type the ticket code (printed under the QR in the email)</label>
          <input id="ticket-code" value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" spellCheck={false} maxLength={60} />
        </div>
        <button type="submit" className="pill-button pill-button--outline" disabled={busy || !manual.trim()}>
          Look up
        </button>
      </form>

      {busy && <p className="account-muted">Checking…</p>}
      {error && <div className="modal-error-banner" style={{ marginTop: 14 }}>{error}</div>}

      {result && verdict && (
        <div className={`ticket-result ticket-result--${verdict.tone}`} aria-live="polite">
          <p className="ticket-verdict">{verdict.text}</p>
          <p className="ticket-name">{result.participant.name}</p>
          <p className="ticket-event">{result.event.name}</p>
          <div className="success-receipt-box account-receipt">
            <div className="receipt-row"><span>Team</span><strong>{result.registration.teamName} · {result.registration.code}</strong></div>
            <div className="receipt-row"><span>College</span><strong>{result.participant.college}</strong></div>
            {result.participant.rollNumber && (
              <div className="receipt-row"><span>Roll number</span><strong>{result.participant.rollNumber}</strong></div>
            )}
            <div className="receipt-row"><span>Email</span><strong>{result.participant.email}</strong></div>
          </div>
          {result.teammates.length > 1 && (
            <ul className="ticket-teammates">
              {result.teammates.map((member) => (
                <li key={member.id} className={member.id === result.participant.id ? "is-current" : ""}>
                  <span>{member.name}</span>
                  <em>{member.checkedInAt ? `entered ${time(member.checkedInAt)}` : "not entered yet"}</em>
                </li>
              ))}
            </ul>
          )}
          {result.admission === "ALLOWED" && !justAdmitted && (
            <button type="button" className="pill-button pill-button--gold ticket-admit" onClick={admit} disabled={busy}>
              Mark entered &amp; give band
            </button>
          )}
        </div>
      )}
    </section>
  )
}
