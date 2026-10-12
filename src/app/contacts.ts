// Official festival contacts and social links, used by the home page hero and the contact section.
// Add a social link here only once its official URL is confirmed.

export type SocialLink = { label: string; handle: string; href: string; icon: "instagram" | "email" }

export const socialLinks: SocialLink[] = [
  {
    label: "Instagram",
    handle: "@shourya_cse",
    href: "https://www.instagram.com/shourya_cse?obrf=MXQ3ZGg3YWRpN3ptZA==",
    icon: "instagram",
  },
  {
    label: "Email",
    handle: "shourya2026@mvsrec.edu.in",
    href: "mailto:shourya2026@mvsrec.edu.in",
    icon: "email",
  },
]

export type PhoneContact = { name: string; phone: string }

// Shown as "Name · 83090 12359"; dialled as +91XXXXXXXXXX.
export const festivalContacts: PhoneContact[] = [
  { name: "Aniketh", phone: "8309012359" },
  { name: "Surya Prakash", phone: "8247859699" },
  { name: "Zeshaan", phone: "7981084902" },
]

export function telHref(phone: string) {
  return `tel:+91${phone}`
}

export function displayPhone(phone: string) {
  return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
}
