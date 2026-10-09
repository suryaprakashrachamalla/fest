import { useState } from "react"

export interface GalleryPhoto {
  id: string
  src: string
  title: string
  category: "all" | "stage" | "performances" | "crowd" | "campus"
  categoryLabel: string
  spanClass?: string
  tiltClass?: string
}

export const defaultGalleryPhotos: GalleryPhoto[] = [
  {
    id: "g-1",
    src: "/gallery/gallery-1.jpg",
    title: "Concert Headliner & Live Crowd",
    category: "stage",
    categoryLabel: "Stage",
    spanClass: "gallery-card--tall",
    tiltClass: "gallery-tilt-left",
  },
  {
    id: "g-2",
    src: "/gallery/gallery-2.jpg",
    title: "DJ Arena & Electronic Beats",
    category: "stage",
    categoryLabel: "Music",
    spanClass: "gallery-card--standard",
    tiltClass: "gallery-tilt-right",
  },
  {
    id: "g-3",
    src: "/gallery/gallery-3.jpg",
    title: "Stage Lighting & Visual Beam Spectacle",
    category: "stage",
    categoryLabel: "Lighting",
    spanClass: "gallery-card--wide",
    tiltClass: "gallery-tilt-none",
  },
  {
    id: "g-4",
    src: "/gallery/gallery-4.jpg",
    title: "Auditorium Presentations & Finals",
    category: "performances",
    categoryLabel: "Arena",
    spanClass: "gallery-card--standard",
    tiltClass: "gallery-tilt-left",
  },
  {
    id: "g-5",
    src: "/gallery/gallery-5.jpg",
    title: "Dance Crew Battle & Choreography",
    category: "performances",
    categoryLabel: "Dance",
    spanClass: "gallery-card--standard",
    tiltClass: "gallery-tilt-right",
  },
  {
    id: "g-6",
    src: "/gallery/gallery-6.jpg",
    title: "Crowd Cheers & Festival Moments",
    category: "crowd",
    categoryLabel: "Vibes",
    spanClass: "gallery-card--tall",
    tiltClass: "gallery-tilt-none",
  },
  {
    id: "g-7",
    src: "/gallery/gallery-7.jpg",
    title: "Campus Heart & Festival Green",
    category: "campus",
    categoryLabel: "Campus",
    spanClass: "gallery-card--standard",
    tiltClass: "gallery-tilt-left",
  },
  {
    id: "g-8",
    src: "/gallery/gallery-8.jpg",
    title: "Lead Guitarist Solo Performance",
    category: "performances",
    categoryLabel: "Live Solo",
    spanClass: "gallery-card--wide",
    tiltClass: "gallery-tilt-right",
  },
  {
    id: "g-9",
    src: "/gallery/gallery-9.jpg",
    title: "MVSR Heritage Gate Entryway",
    category: "campus",
    categoryLabel: "Heritage",
    spanClass: "gallery-card--standard",
    tiltClass: "gallery-tilt-none",
  },
  {
    id: "g-10",
    src: "/gallery/gallery-10.jpg",
    title: "Festival Hours & Nightfall Energy",
    category: "crowd",
    categoryLabel: "Nightfall",
    spanClass: "gallery-card--standard",
    tiltClass: "gallery-tilt-left",
  },
]

export default function GallerySection() {
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [activePhoto, setActivePhoto] = useState<GalleryPhoto | null>(null)

  const filteredPhotos =
    activeFilter === "all"
      ? defaultGalleryPhotos
      : defaultGalleryPhotos.filter((p) => p.category === activeFilter)

  return (
    <section id="gallery" className="gallery-section">
      {/* Torn Paper Rip Divider on top */}
      <div className="torn-paper-edge" aria-hidden="true">
        <svg
          viewBox="0 0 1200 48"
          preserveAspectRatio="none"
          className="torn-svg"
        >
          {/* Layer 1: Warm Golden Kraft Paper */}
          <path
            d="M0,0 L1200,0 L1200,24 L1180,34 L1155,18 L1130,30 L1105,20 L1080,34 L1050,16 L1020,32 L995,22 L970,36 L940,18 L915,32 L885,16 L860,34 L830,20 L800,38 L770,18 L745,33 L715,20 L685,36 L655,21 L625,37 L595,18 L565,34 L535,20 L505,36 L475,19 L445,35 L415,21 L385,37 L355,18 L325,33 L295,20 L265,36 L235,19 L205,35 L175,21 L145,37 L115,18 L85,34 L55,20 L25,36 L0,22 Z"
            fill="#d4a34b"
          />
          {/* Layer 2: Matching Events Section Cream Background (#F2EFE8) */}
          <path
            d="M0,0 L1200,0 L1200,14 L1175,26 L1150,12 L1125,24 L1095,14 L1070,28 L1040,12 L1010,26 L985,15 L960,30 L930,12 L905,26 L875,11 L850,28 L820,14 L790,32 L760,12 L735,27 L705,14 L675,30 L645,15 L615,31 L585,12 L555,28 L525,14 L495,30 L465,13 L435,29 L405,15 L375,31 L345,12 L315,27 L285,14 L255,30 L225,13 L195,29 L165,15 L135,31 L105,12 L75,28 L45,14 L15,30 L0,16 Z"
            fill="#F2EFE8"
          />
        </svg>
      </div>

      <div className="gallery-container">
        {/* Gallery Header */}
        <div className="gallery-header">
          <div>
            <span className="gallery-eyebrow">ARCHIVE & VIBES</span>
            <h2 className="gallery-title">GALLERY</h2>
          </div>
          <p className="gallery-subtitle">
            Unfiltered energy, historic sets, and the people who brought the noise.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="gallery-filters" role="tablist">
          {[
            { id: "all", label: "ALL MOMENTS" },
            { id: "stage", label: "STAGE & MUSIC" },
            { id: "performances", label: "PERFORMANCES" },
            { id: "crowd", label: "CROWD & VIBES" },
            { id: "campus", label: "CAMPUS" },
          ].map((tab) => (
            <button
              type="button"
              key={tab.id}
              role="tab"
              aria-selected={activeFilter === tab.id}
              className={`gallery-filter-pill ${activeFilter === tab.id ? "active" : ""}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Collage Photo Grid */}
        <div className="gallery-collage-grid">
          {filteredPhotos.map((photo, index) => (
            <figure
              key={photo.id}
              className={`gallery-card ${photo.spanClass || ""} ${photo.tiltClass || ""}`}
              onClick={() => setActivePhoto(photo)}
              style={{ "--card-index": index } as React.CSSProperties}
            >
              <div className="gallery-img-wrapper">
                <img
                  src={photo.src}
                  alt={photo.title}
                  loading="lazy"
                  onError={(e) => {
                    // Fallback to unsplash if local file not yet uploaded
                    const target = e.currentTarget
                    target.src =
                      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80"
                  }}
                />
                <div className="gallery-card-overlay">
                  <span className="gallery-card-tag">{photo.categoryLabel}</span>
                  <p className="gallery-card-caption">{photo.title}</p>
                  <span className="gallery-zoom-badge">↗</span>
                </div>
              </div>
            </figure>
          ))}
        </div>

        {/* Folder notice for user */}
        <div className="gallery-folder-hint">
          <span>📁 Photos folder active: <code>public/gallery/</code> (Add or replace photos anytime)</span>
        </div>
      </div>

      {/* Lightbox Modal */}
      {activePhoto && (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
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
            <img src={activePhoto.src} alt={activePhoto.title} />
            <div className="gallery-lightbox-info">
              <span className="gallery-card-tag">{activePhoto.categoryLabel}</span>
              <h3>{activePhoto.title}</h3>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
