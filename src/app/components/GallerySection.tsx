import { useEffect, useState } from "react"

export interface GalleryPhoto {
  src: string
  alt: string
}

// Tiles fill column by column (left column top to bottom, then the next column).
// Add more photos to extend the collage: every 9 photos adds another mirrored block.
export const galleryPhotos: GalleryPhoto[] = [
  { src: "/gallery/Unknown-2.jpeg", alt: "Pink and white streamers over the main road at night" },
  { src: "/gallery/fest-night-lanterns.jpg", alt: "Paper lanterns strung past a block lit in red, blue and purple" },
  { src: "/gallery/Unknown-1.jpeg", alt: "Bunting strung across the corridor between campus blocks" },
  { src: "/gallery/WhatsApp Image 2026-10-10 at 12.00.19 PM.jpeg", alt: "Campus building lit up in pink and green" },
  { src: "/gallery/fest-night-green-block.jpg", alt: "Main building lit green with students gathered on the road" },
  { src: "/gallery/IMG_5073.PNG", alt: "Fairy lights under the trees at dusk" },
  { src: "/gallery/Unknown.jpeg", alt: "Crowd walking under the lit-up trees" },
  { src: "/mvsr-campus.jpg", alt: "MVSR main building at sunset" },
  { src: "/gallery/IMG_5074.PNG", alt: "Lanterns hanging over the crowd at night" },
]

type Seam = [number, number]

interface ShatterLayout {
  w: number
  h: number
  // Vertical seams as [x at top, x at bottom], including both outer edges.
  columns: Seam[]
  // Per column, the slanted cuts between stacked tiles as [y at left, y at right].
  cuts: Seam[][]
}

const DESKTOP_LAYOUT: ShatterLayout = {
  w: 1600,
  h: 1150,
  columns: [
    [0, 0],
    [405, 420],
    [830, 795],
    [1220, 1265],
    [1600, 1600],
  ],
  cuts: [[[640, 605]], [[330, 365], [760, 715]], [[520, 585]], [[375, 330]]],
}

const MOBILE_LAYOUT: ShatterLayout = {
  w: 800,
  h: 1500,
  columns: [
    [0, 0],
    [415, 385],
    [800, 800],
  ],
  cuts: [
    [[380, 350], [790, 830], [1160, 1130]],
    [[270, 310], [600, 565], [930, 975], [1240, 1210]],
  ],
}

type Point = [number, number]

interface Tile {
  points: Point[]
  box: { x: number; y: number; w: number; h: number }
}

function buildTiles({ w, h, columns, cuts }: ShatterLayout, mirror: boolean): Tile[] {
  const xAt = ([top, bottom]: Seam, y: number) => top + ((bottom - top) * y) / h
  const tiles: Tile[] = []

  cuts.forEach((colCuts, col) => {
    const left = columns[col]
    const right = columns[col + 1]
    const rows: Seam[] = [[0, 0], ...colCuts, [h, h]]

    for (let r = 0; r < rows.length - 1; r++) {
      const [topL, topR] = rows[r]
      const [botL, botR] = rows[r + 1]
      let points: Point[] = [
        [xAt(left, topL), topL],
        [xAt(right, topR), topR],
        [xAt(right, botR), botR],
        [xAt(left, botL), botL],
      ]
      if (mirror) points = points.map(([x, y]) => [w - x, y])

      const xs = points.map((p) => p[0])
      const ys = points.map((p) => p[1])
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      tiles.push({
        points,
        box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
      })
    }
  })

  return tiles
}

// Deterministic rough edge so the torn paper looks the same on every render.
function tornEdge(seed: number, width: number, base: number, amp: number, fillAbove: boolean, height: number) {
  let s = seed
  const rand = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const phase = rand() * 10
  const pts: string[] = []
  for (let x = 0; x <= width; x += 5 + rand() * 7) {
    const wave =
      Math.sin(x / 210 + phase) * amp * 0.6 + Math.sin(x / 67 + phase * 2) * amp * 0.25
    const fibre = (rand() - 0.5) * amp * 0.55
    pts.push(`${x.toFixed(1)},${(base + wave + fibre).toFixed(1)}`)
  }
  pts.push(`${width},${base}`)
  const edgeY = fillAbove ? 0 : height
  return `M0,${edgeY} L${pts.join(" L")} L${width},${edgeY} Z`
}

const TOP_EDGE = {
  cream: tornEdge(7, 1600, 18, 10, true, 140),
  gold: tornEdge(19, 1600, 74, 26, true, 140),
  fringe: tornEdge(31, 1600, 112, 30, true, 140),
  white: tornEdge(43, 1600, 104, 30, true, 140),
}

const BOTTOM_EDGE = {
  fringe: tornEdge(59, 1600, 40, 26, false, 100),
  white: tornEdge(71, 1600, 50, 26, false, 100),
  footer: tornEdge(83, 1600, 82, 14, false, 100),
}

function ShatterCollage({
  layout,
  idPrefix,
  className,
  onOpen,
}: {
  layout: ShatterLayout
  idPrefix: string
  className: string
  onOpen: (photo: GalleryPhoto) => void
}) {
  const block = buildTiles(layout, false)
  const mirrored = buildTiles(layout, true)
  const blockCount = Math.max(1, Math.ceil(galleryPhotos.length / block.length))

  const tiles = Array.from({ length: blockCount }, (_, b) =>
    (b % 2 ? mirrored : block).map((tile) => ({
      ...tile,
      points: tile.points.map(([x, y]) => [x, y + b * layout.h] as Point),
      box: { ...tile.box, y: tile.box.y + b * layout.h },
    })),
  ).flat()

  return (
    <svg
      className={`shatter-svg ${className}`}
      viewBox={`0 0 ${layout.w} ${layout.h * blockCount}`}
      role="list"
      aria-label="Fest photo gallery"
    >
      <defs>
        {tiles.map((tile, i) => (
          <clipPath key={i} id={`${idPrefix}-${i}`}>
            <polygon points={tile.points.join(" ")} />
          </clipPath>
        ))}
      </defs>

      {tiles.map((tile, i) => {
        const photo = galleryPhotos[i % galleryPhotos.length]
        const points = tile.points.join(" ")
        return (
          <g
            key={i}
            className="shatter-tile"
            role="listitem"
            tabIndex={0}
            aria-label={`Open photo: ${photo.alt}`}
            onClick={() => onOpen(photo)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onOpen(photo)
              }
            }}
          >
            <g clipPath={`url(#${idPrefix}-${i})`}>
              <image
                className="shatter-img"
                href={encodeURI(photo.src)}
                x={tile.box.x}
                y={tile.box.y}
                width={tile.box.w}
                height={tile.box.h}
                preserveAspectRatio="xMidYMid slice"
              />
            </g>
            <polygon className="shatter-seam" points={points} />
            <polygon className="shatter-focus" points={points} />
          </g>
        )
      })}
    </svg>
  )
}

export default function GallerySection() {
  const [activePhoto, setActivePhoto] = useState<GalleryPhoto | null>(null)

  useEffect(() => {
    if (!activePhoto) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActivePhoto(null)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activePhoto])

  return (
    <section id="gallery" className="shatter-section">
      <svg
        className="shatter-tear shatter-tear--top"
        viewBox="0 0 1600 140"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={TOP_EDGE.fringe} fill="#d9d6cf" />
        <path d={TOP_EDGE.white} fill="#f7f5f0" />
        <path d={TOP_EDGE.gold} fill="#d4a34b" />
        <path d={TOP_EDGE.cream} fill="#F2EFE8" />
      </svg>

      <div className="shatter-heading">
        <div>
          <span className="shatter-eyebrow">ARCHIVES OF SANGAMAM</span>
          <h2 className="shatter-title">GALLERY</h2>
        </div>
        <p className="shatter-subtitle">
          Lanterns, lights and late nights from the moments that lit up our campus.
        </p>
      </div>

      <ShatterCollage
        layout={DESKTOP_LAYOUT}
        idPrefix="shatter-d"
        className="shatter-svg--desktop"
        onOpen={setActivePhoto}
      />
      <ShatterCollage
        layout={MOBILE_LAYOUT}
        idPrefix="shatter-m"
        className="shatter-svg--mobile"
        onOpen={setActivePhoto}
      />

      <svg
        className="shatter-tear shatter-tear--bottom"
        viewBox="0 0 1600 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={BOTTOM_EDGE.fringe} fill="#d9d6cf" />
        <path d={BOTTOM_EDGE.white} fill="#ffffff" />
        <path d={BOTTOM_EDGE.footer} fill="#08070b" />
      </svg>

      {activePhoto && (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={activePhoto.alt}
          onClick={() => setActivePhoto(null)}
        >
          <div
            className="gallery-lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="gallery-lightbox-close"
              aria-label="Close photo preview"
              onClick={() => setActivePhoto(null)}
            >
              ✕
            </button>
            <img src={encodeURI(activePhoto.src)} alt={activePhoto.alt} />
            <div className="gallery-lightbox-info">
              <h3>{activePhoto.alt}</h3>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
