// Prefixes a public/ path with the deploy base ("/" locally, "/fest/" on GitHub Pages).
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`
