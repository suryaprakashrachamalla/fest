import { useEffect, useState } from "react"
import { onIntroDone } from "../introState"

// Each letter flips through its sound in ten scripts before landing on the Latin letter:
// Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali, Gujarati, Japanese, Chinese, Korean.
const GLYPHS: Record<string, string[]> = {
  S: ["స", "स", "ஸ", "ಸ", "സ", "স", "સ", "サ", "斯", "스"],
  H: ["హ", "ह", "ஹ", "ಹ", "ഹ", "হ", "હ", "ハ", "赫", "흐"],
  O: ["ఓ", "ओ", "ஓ", "ಓ", "ഓ", "ও", "ઓ", "オ", "欧", "오"],
  U: ["ఉ", "उ", "உ", "ಉ", "ഉ", "উ", "ઉ", "ウ", "乌", "우"],
  R: ["ర", "र", "ர", "ರ", "ര", "র", "ર", "ラ", "尔", "르"],
  Y: ["య", "य", "ய", "ಯ", "യ", "য", "ય", "ヤ", "亚", "야"],
  A: ["అ", "अ", "அ", "ಅ", "അ", "অ", "અ", "ア", "阿", "아"],
}

const STEP_MS = 70
const STAGGER_MS = 120

export default function ScriptReveal({
  text,
  className = "",
  waitForIntro = false,
}: {
  text: string
  className?: string
  waitForIntro?: boolean
}) {
  const letters = text.split("")
  // -1 = not started (blank), 0..9 = cycling through scripts, 10+ = settled on the letter.
  const [steps, setSteps] = useState<number[]>(() => letters.map(() => -1))

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduceMotion) {
      setSteps(letters.map(() => 99))
      return
    }

    let frame = 0
    let start = 0
    const tick = (now: number) => {
      if (!start) start = now
      const elapsed = now - start
      const next = letters.map((_, i) => Math.floor((elapsed - i * STAGGER_MS) / STEP_MS))
      setSteps(next.map((s) => Math.max(-1, s)))
      const settled = next.every((s, i) => s >= (GLYPHS[letters[i]]?.length ?? 0))
      if (!settled) frame = requestAnimationFrame(tick)
    }

    const begin = () => {
      frame = requestAnimationFrame(tick)
    }
    const stopWaiting = waitForIntro ? onIntroDone(begin) : (begin(), () => {})

    return () => {
      stopWaiting()
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, waitForIntro])

  return (
    <span className={`script-reveal ${className}`} aria-label={text} role="img">
      {letters.map((letter, i) => {
        const glyphs = GLYPHS[letter] ?? []
        const step = steps[i]
        const settled = step >= glyphs.length
        const glyph = step < 0 ? "" : settled ? letter : glyphs[step]
        return (
          <span
            key={`${letter}-${i}`}
            className={`script-reveal-cell ${settled ? "is-settled" : ""}`}
            aria-hidden="true"
          >
            {/* The hidden final letter reserves the width so nothing jumps while glyphs cycle. */}
            <span className="script-reveal-sizer">{letter}</span>
            <span className={`script-reveal-glyph ${settled ? "" : "is-foreign"}`}>{glyph}</span>
          </span>
        )
      })}
    </span>
  )
}
