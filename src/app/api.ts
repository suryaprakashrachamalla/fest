// Client for the fest registration backend (fest-backend). Set VITE_API_URL to its public HTTPS origin.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "")
const TOKEN_KEY = "sangamam.token"
const USER_KEY = "sangamam.user"

export const apiConfigured = API_BASE !== ""

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type RegistrationStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_REVIEW"
  | "PAYMENT_VERIFIED"
  | "APPROVED"
  | "TICKET_ISSUED"
  | "PAYMENT_REJECTED"
  | "REJECTED"

export interface User {
  id: string
  name: string
  email: string
  role: "USER" | "ADMIN"
}

export interface BackendEvent {
  id: string
  name: string
  slug: string
  feePaise: number
  feeMode: "FLAT" | "PER_HEAD"
  minTeamSize: number
  maxTeamSize: number
}

export interface Participant {
  id: string
  name: string
  email: string
  college: string
  rollNumber: string | null
  lumaCheckedInAt?: string | null
  ticketEmailedAt?: string | null
  ticketEmailError?: string | null
  checkedInAt?: string | null
  checkedInBy?: { name: string } | null
}

// What the entrance scanner shows for a scanned entry QR.
export interface TicketScan {
  admission: "ALLOWED" | "ALREADY_ENTERED" | "NOT_APPROVED"
  // True when this scan recorded the entry (the ticket's first valid scan).
  justAdmitted?: boolean
  participant: {
    id: string
    name: string
    email: string
    college: string
    rollNumber: string | null
    checkedInAt: string | null
    checkedInBy: string | null
  }
  registration: { id: string; code: string; teamName: string; teamSize: number; college: string; status: RegistrationStatus }
  event: { name: string; slug: string }
  teammates: { id: string; name: string; checkedInAt: string | null }[]
}

export interface PaymentProof {
  id: string
  utr: string
  paymentMethod: string
  status: "PENDING" | "VERIFIED" | "REJECTED"
  submittedAt: string
  reviewedAt: string | null
  rejectionReason: string | null
}

export interface Registration {
  id: string
  code: string
  teamName: string
  teamSize: number
  college: string
  phone: string
  amountPaise: number
  status: RegistrationStatus
  rejectionReason: string | null
  createdAt: string
  approvedAt: string | null
  lumaSyncedAt?: string | null
  lumaError?: string | null
  entered: boolean
  enteredAt?: string | null
  event: BackendEvent
  participants: Participant[]
  paymentProofs: PaymentProof[]
  user?: { id: string; name: string; email: string }
  verifiedAt?: string | null
  verifiedBy?: { name: string; email: string } | null
  approvedBy?: { name: string; email: string } | null
}

export interface PaymentQr {
  id: string
  label: string
  isActive: boolean
  createdAt: string
}

export interface AuditEntry {
  id: string
  action: string
  fromStatus: RegistrationStatus | null
  toStatus: RegistrationStatus | null
  detail: string | null
  createdAt: string
  actor: { name: string; role: string } | null
}

export interface NewRegistration {
  teamName: string
  college: string
  phone: string
  participants: { name: string; email: string; rollNumber?: string }[]
}

function readStorage(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private mode); the session then lasts for this page only.
  }
}

let memoryToken: string | null = readStorage(TOKEN_KEY)

export function getToken() {
  return memoryToken
}

// The sign-in token's expiry (JWT "exp", in seconds), or null if it can't be read.
function tokenExpiry(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

export function getStoredUser(): User | null {
  const raw = readStorage(USER_KEY)
  if (!raw || !memoryToken) return null
  // An expired sign-in is cleared up front, so pages ask to sign in once instead of failing later.
  const expiresAt = tokenExpiry(memoryToken)
  if (expiresAt !== null && expiresAt <= Date.now()) {
    signOut()
    return null
  }
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function saveSession(token: string, user: User) {
  memoryToken = token
  writeStorage(TOKEN_KEY, token)
  writeStorage(USER_KEY, JSON.stringify(user))
}

export function signOut() {
  memoryToken = null
  writeStorage(TOKEN_KEY, null)
  writeStorage(USER_KEY, null)
}

async function request<T>(
  path: string,
  options: { method?: string; json?: unknown; form?: FormData; auth?: boolean } = {},
): Promise<T> {
  if (!apiConfigured) {
    throw new ApiError(0, "Online registration isn't connected yet. Please check back soon.")
  }
  const headers: Record<string, string> = {}
  if (options.json !== undefined) headers["Content-Type"] = "application/json"
  if (options.auth !== false && memoryToken) headers.Authorization = `Bearer ${memoryToken}`
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? (options.json !== undefined || options.form ? "POST" : "GET"),
      headers,
      body: options.form ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined),
    })
  } catch {
    throw new ApiError(0, "Can't reach the registration server right now. Please try again in a moment.")
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    if (response.status === 401 && options.auth !== false) signOut()
    const message =
      body?.error?.message ??
      (response.status === 429 ? "Too many attempts. Please wait a few minutes." : "Something went wrong. Please try again.")
    throw new ApiError(response.status, message)
  }
  return body.data as T
}

// Creates the account only; the person signs in separately afterwards.
export async function createAccount(name: string, email: string, password: string) {
  await request("/auth/signup", { json: { name, email, password }, auth: false })
}

export async function signUp(name: string, email: string, password: string) {
  await createAccount(name, email, password)
  return signIn(email, password)
}

export async function signIn(email: string, password: string) {
  const data = await request<{ token: string; user: User }>("/auth/signin", {
    json: { email, password },
    auth: false,
  })
  saveSession(data.token, data.user)
  return data.user
}

export function listEvents() {
  return request<BackendEvent[]>("/events", { auth: false })
}

export async function findEventBySlug(slug: string) {
  const events = await listEvents()
  return events.find((event) => event.slug === slug) ?? null
}

export function feeFor(event: BackendEvent, teamSize: number) {
  return event.feeMode === "PER_HEAD" ? event.feePaise * teamSize : event.feePaise
}

export function createRegistration(eventId: string, data: NewRegistration) {
  return request<Registration>(`/events/${eventId}/registrations`, { json: data })
}

export function submitPaymentProof(registrationId: string, utr: string, paymentMethod: string, screenshot: File) {
  const form = new FormData()
  form.append("utr", utr)
  form.append("paymentMethod", paymentMethod)
  form.append("screenshot", screenshot)
  return request<{ proofId: string; status: string }>(`/registrations/${registrationId}/payment-proofs`, { form })
}

export function myRegistrations() {
  return request<Registration[]>("/registrations/me")
}

// Fetches an image that needs the signed-in token and returns a temporary object URL for <img>.
async function authorizedImageUrl(path: string, failure: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {},
  })
  if (!response.ok) throw new ApiError(response.status, failure)
  return URL.createObjectURL(await response.blob())
}

// A team member's entry QR (available once the registration is approved).
export function ticketQrUrl(registrationId: string, participantId: string) {
  return authorizedImageUrl(`/registrations/${registrationId}/participants/${participantId}/ticket`, "Couldn't load the ticket QR")
}

// Falls back to the bundled demo QR until an organizer uploads and activates the real one.
export async function paymentQrUrl() {
  const demo = `${import.meta.env.BASE_URL}payment-qr-demo.png`
  try {
    const active = await request<{ id: string } | null>("/payment-qr/active", { auth: false })
    return active ? { url: `${API_BASE}/payment-qr/active/image`, isDemo: false } : { url: demo, isDemo: true }
  } catch {
    return { url: demo, isDemo: true }
  }
}

export const admin = {
  registrations: (status?: RegistrationStatus) =>
    request<Registration[]>(`/admin/registrations${status ? `?status=${status}` : ""}`),
  verifyProof: (proofId: string) => request(`/admin/payment-proofs/${proofId}/verify`, { method: "PATCH" }),
  rejectProof: (proofId: string, reason: string) =>
    request(`/admin/payment-proofs/${proofId}/reject`, { method: "PATCH", json: { reason } }),
  approve: (registrationId: string) =>
    request<{ alreadyApproved: boolean }>(`/admin/registrations/${registrationId}/approve`, { method: "PATCH" }),
  reject: (registrationId: string, reason: string) =>
    request(`/admin/registrations/${registrationId}/reject`, { method: "PATCH", json: { reason } }),
  audit: (registrationId: string) => request<AuditEntry[]>(`/admin/registrations/${registrationId}/audit`),
  syncStatus: () =>
    request<{
      configured: boolean
      counts: Partial<Record<"PENDING" | "PROCESSING" | "COMPLETED" | "FAILED", number>>
      lastError: string | null
      lastSuccessfulSyncAt: string | null
    }>("/admin/sync-status"),
  // Entrance: look up a scanned entry QR, then record that member's entry.
  // admit=true records the entry on the ticket's first valid scan; reusing scanId on a retry is safe.
  scanTicket: (code: string, admit = false, scanId?: string) =>
    request<TicketScan>("/admin/tickets/scan", { json: { code, admit, scanId } }),
  admitParticipant: (participantId: string) =>
    request<TicketScan>(`/admin/tickets/${participantId}/check-in`, { method: "POST" }),
  ticketMailStatus: () => request<{ configured: boolean; pending: number; failed: number }>("/admin/tickets/mail-status"),
  // Emails the same entry QR again to one member, or to the whole team.
  resendTickets: (registrationId: string, participantId?: string) =>
    request(`/admin/registrations/${registrationId}/resend-tickets`, { json: participantId ? { participantId } : {} }),
  // Re-checks every row against the sheet and retries failed sync jobs.
  retrySync: () => request("/admin/sync-reconcile", { method: "POST" }),
  paymentQrs: () => request<PaymentQr[]>("/admin/payment-qrs"),
  addPaymentQr: (label: string, image: File) => {
    const form = new FormData()
    form.append("label", label)
    form.append("image", image)
    return request<PaymentQr>("/admin/payment-qrs", { form })
  },
  setPaymentQrActive: (id: string, isActive: boolean) =>
    request<PaymentQr>(`/admin/payment-qrs/${id}/active`, { method: "PATCH", json: { isActive } }),
  paymentQrImageUrl: (id: string) => authorizedImageUrl(`/admin/payment-qrs/${id}/image`, "Couldn't load the QR image"),
  // Screenshots need the admin token, so they are fetched and shown as a temporary object URL.
  screenshotUrl: (proofId: string) =>
    authorizedImageUrl(`/admin/payment-proofs/${proofId}/screenshot`, "Couldn't load the payment screenshot"),
}

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  PENDING_PAYMENT: "Payment pending",
  PAYMENT_REVIEW: "Payment under review",
  PAYMENT_VERIFIED: "Payment verified",
  APPROVED: "Approved",
  TICKET_ISSUED: "Ticket issued",
  PAYMENT_REJECTED: "Payment rejected",
  REJECTED: "Registration rejected",
}

// What registrants see: payment review and verification are one "waiting for approval" stage.
export const PARTICIPANT_STATUS_LABELS: Record<RegistrationStatus, string> = {
  ...STATUS_LABELS,
  PAYMENT_REVIEW: "Waiting for approval",
  PAYMENT_VERIFIED: "Waiting for approval",
}

export function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}
