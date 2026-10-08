export type EventCategory = "Technical" | "Semi-Technical" | "Cultural" | "Fun"

export type FestivalEvent = {
  slug: string
  name: string
  category: EventCategory
  number: string
  tagline: string
  description: string
  format: string
  team: string
  duration: string
  date: string
  time: string
  accent: string
  image: string
  challenges: string[]
}

const techImage =
  "https://images.unsplash.com/photo-1517983079452-bbaa6a081a6b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const codeImage =
  "https://images.unsplash.com/photo-1759661881353-5b9cc55e1cf4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const musicImage =
  "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const comedyImage =
  "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const recreationImage =
  "https://images.unsplash.com/photo-1560831340-b9679dc9e9f0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"

export const events: FestivalEvent[] = [
  {
    slug: "hackathon",
    name: "Hackathon",
    category: "Technical",
    number: "01",
    tagline: "Build the impossible before the clock runs out.",
    description:
      "An intense product sprint where teams turn bold ideas into working prototypes. Expect surprise problem statements, mentor checkpoints, and a final jury pitch.",
    format: "Build + pitch",
    team: "2–4 members",
    duration: "27 hours",
    date: "16 & 17 · Day 1 & 2",
    time: "10 AM – 1 PM next day",
    accent: "#e8ddc4",
    image: techImage,
    challenges: [
      "Product originality",
      "Technical execution",
      "Real-world impact",
    ],
  },
  {
    slug: "no-code-vibathon",
    name: "No Code Vibathon",
    category: "Technical",
    number: "02",
    tagline: "Ship a real idea without writing a line of code.",
    description:
      "Design, automate, and launch a useful digital experience with no-code tools. This is rapid experimentation for makers who think in flows, systems, and outcomes.",
    format: "Prototype sprint",
    team: "1–3 members",
    duration: "6 hours",
    date: "16 · Day 1",
    time: "10 AM – 4 PM",
    accent: "#ff5c35",
    image: codeImage,
    challenges: [
      "Creative tool use",
      "User experience",
      "Working demonstration",
    ],
  },
  {
    slug: "github-workshop",
    name: "GitHub Workshop",
    category: "Technical",
    number: "03",
    tagline: "From first commit to confident collaboration.",
    description:
      "A hands-on workshop covering repositories, branches, pull requests, issues, and the habits that make open-source collaboration feel effortless.",
    format: "Guided workshop",
    team: "Individual",
    duration: "3 hours",
    date: "16 · Day 1",
    time: "2 PM – 5 PM",
    accent: "#a78bfa",
    image: codeImage,
    challenges: [
      "Live exercises",
      "Open-source workflow",
      "Collaboration basics",
    ],
  },
  {
    slug: "build-lab",
    name: "Build Lab — Product Design Challenge",
    category: "Semi-Technical",
    number: "04",
    tagline: "Turn a messy problem into a product people want.",
    description:
      "A product design challenge combining research, strategy, interface thinking, and storytelling. No polished portfolio required—just curiosity and clear decisions.",
    format: "Design challenge",
    team: "2–3 members",
    duration: "7 hours",
    date: "16 · Day 1",
    time: "10 AM – 5 PM",
    accent: "#52e5ff",
    image: techImage,
    challenges: ["Problem framing", "Product thinking", "Final concept pitch"],
  },
  {
    slug: "music-mob",
    name: "Music Mob",
    category: "Cultural",
    number: "05",
    tagline: "One campus. One beat. Every voice turned up.",
    description:
      "A high-energy collective music experience for bands, soloists, beatboxers, and unexpected collaborations. Bring your sound and move the crowd.",
    format: "Live performance",
    team: "Solo or group",
    duration: "1.5 hours",
    date: "17 · Day 2",
    time: "2 PM – 3:30 PM",
    accent: "#ff3cac",
    image: musicImage,
    challenges: ["Stage presence", "Musicality", "Audience connection"],
  },
  {
    slug: "standup-comedy",
    name: "Standup Comedy",
    category: "Fun",
    number: "06",
    tagline: "Five minutes. One mic. Make the room lose it.",
    description:
      "Original sets, sharp observations, and fearless delivery. The stage is open to first-timers and seasoned campus comics alike.",
    format: "Open mic",
    team: "Individual",
    duration: "2 hours",
    date: "17 · Day 2",
    time: "12 PM – 2 PM",
    accent: "#ffd43b",
    image: comedyImage,
    challenges: ["Originality", "Timing", "Audience response"],
  },
  {
    slug: "recreation-creative",
    name: "Recreation & Creative Events",
    category: "Fun",
    number: "07",
    tagline: "Play, make, remix, repeat.",
    description:
      "A rotating playground of quick games, visual challenges, collaborative art, and surprise activities designed to reset your brain between main-stage moments.",
    format: "Drop-in arena",
    team: "Open",
    duration: "4 hours",
    date: "17 · Day 2",
    time: "10 AM – 2 PM",
    accent: "#ff7a00",
    image: recreationImage,
    challenges: ["Rapid challenges", "Creative stations", "Team games"],
  },
]

export const categories: EventCategory[] = [
  "Technical",
  "Semi-Technical",
  "Cultural",
  "Fun",
]
