// Lets the home hero wait for the intro preloader before playing its title reveal.
let introDone = false
const listeners = new Set<() => void>()

export function markIntroDone() {
  if (introDone) return
  introDone = true
  listeners.forEach((listener) => listener())
  listeners.clear()
}

export function onIntroDone(listener: () => void) {
  if (introDone) {
    listener()
    return () => {}
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
