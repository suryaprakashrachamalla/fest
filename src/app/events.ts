import { publicUrl } from "./publicUrl"

export type EventCategory = "Technical" | "Semi-Technical" | "Cultural" | "Fun"

export type FestivalEvent = {
  slug: string
  name: string
  category: EventCategory
  number: string
  tagline?: string
  description: string
  format: string
  team: string
  duration: string
  date: string
  time: string
  venue?: string
  fee?: string
  // Label for the fee row, e.g. "Entry fee"; defaults to "Fee".
  feeLabel?: string
  // Shown as a Food row in the event facts.
  food?: string
  // Total prize pool, shown in the hero and the facts list.
  prize?: string
  // Headline total for the hero only, shown as "Total prize pool worth" in place of the prize pool.
  heroPrize?: string
  // Optional per-place breakdown listed under the prize pool.
  prizes?: [string, string][]
  accent: string
  image: string
  // CSS object-position for the event page hero, to keep the subject in frame.
  imagePosition?: string
  // Separate home page card photo, e.g. a crop that centers the subject.
  cardImage?: string
  challenges: string[]
  // Heading above the challenges list; events without one use the default arena copy.
  criteria?: { label: string; title: [string, string] }
  performer?: { name: string; handle: string; instagram: string; bio?: string }
  // Sub-events listed in the About section, with an optional line beneath them.
  activities?: string[]
  activitiesNote?: string
  // Performance nights skip the judging criteria section.
  hideCriteria?: boolean
  // Walk-in events show their details only, with no register buttons.
  noRegistration?: boolean
  // Overrides the walk-in entry text shown in the facts.
  entry?: string
  // Events registered for in person on campus: no online button, shown in the facts instead.
  registerAt?: string
  // Label for the team row, for events where "Team" doesn't fit (e.g. eligibility).
  teamLabel?: string
}

const techImage =
  "https://images.unsplash.com/photo-1517983079452-bbaa6a081a6b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const codeImage =
  "https://images.unsplash.com/photo-1759661881353-5b9cc55e1cf4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const githubImage =
  "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const productDesignImage =
  "https://images.unsplash.com/photo-1552664730-d307ca884978?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"
const musicImage = publicUrl("/gallery/music-mob.jpg")
const comedyImage = publicUrl("/gallery/standup-comedy.jpg")
const dandiyaImage = publicUrl("/gallery/dandiya-night.jpg")
const recreationImage =
  "https://images.unsplash.com/photo-1560831340-b9679dc9e9f0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600"

export const events: FestivalEvent[] = [
  {
    slug: "hackathon",
    name: "HACKATHON",
    category: "Technical",
    number: "01",
    tagline: "Build the impossible before the clock runs out.",
    description:
      "An intense product sprint where teams turn bold ideas into working prototypes. Problem statements will be provided on the spot, with mentor checkpoints along the way and a final jury pitch.",
    format: "Build + pitch",
    team: "2–3 members",
    duration: "27 hours",
    date: "16 & 17 · Day 1 & 2",
    time: "10 AM – 1 PM next day",
    venue: "CSE Labs 2, 3, 4, 5",
    food: "Provided · No extra charge",
    fee: "₹399 / head",
    heroPrize: "₹4L+",
    accent: "#e8ddc4",
    image: techImage,
    criteria: { label: "Hackathon domains", title: ["Pick your domain.", "We'll bring the arena."] },
    challenges: [
      "Cybersecurity",
      "Defence",
      "AI / ML",
      "Autonomous Systems & Robotics",
      "HealthTech & MedTech",
      "FinTech & Blockchain",
      "Smart Cities & IoT",
      "Sustainability & Climate Tech",
      "AgriTech & Rural Innovation",
      "EdTech & Accessibility",
      "Space & Aerospace Tech",
      "AR / VR & Metaverse",
      "Open Innovation",
    ],
  },
  {
    slug: "no-code-vibathon",
    name: "NOCODE VIBEATHON",
    category: "Technical",
    number: "02",
    tagline: "Ship a real idea without writing a line of code.",
    description:
      "Design, automate, and launch a useful digital experience with no-code tools. This is rapid experimentation for makers who think in flows, systems, and outcomes.",
    format: "Prototype sprint",
    team: "1–2 members",
    duration: "6 hours",
    date: "16 · Day 1",
    time: "10 AM – 4 PM",
    venue: "CS-11, 12 (2 classrooms)",
    fee: "₹300 / team",
    prize: "₹15,000",
    accent: "#ff5c35",
    image: codeImage,
    criteria: { label: "How you're judged", title: ["Skip the syntax.", "Ship the idea."] },
    challenges: [
      "Smart, creative use of no-code tools",
      "A clean, intuitive user experience",
      "A working demo built on the day",
    ],
  },
  {
    slug: "github-workshop",
    name: "GITHUB WORKSHOP",
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
    venue: "CSE Seminar Hall",
    fee: "₹150 / head",
    prize: "₹10,000",
    accent: "#a78bfa",
    image: githubImage,
    criteria: { label: "What you'll learn", title: ["Commit. Push.", "Collaborate."] },
    challenges: [
      "Git basics: init, add, commit and a clean history",
      "Branches, merges and fixing merge conflicts",
      "Pull requests, code reviews and issues on GitHub",
      "Your profile README and a first open-source contribution",
      "Bring a laptop with Git installed and a free GitHub account",
    ],
  },
  {
    slug: "build-lab",
    name: "BUILD LAB — PRODUCT DESIGN CHALLENGE",
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
    venue: "CSE Seminar Hall\nCS-201, 211, 212, 213 (4 classrooms)",
    fee: "₹150 / head",
    prize: "₹15,000",
    accent: "#52e5ff",
    image: productDesignImage,
    challenges: ["Problem framing", "Product thinking", "Final concept pitch"],
  },
  {
    slug: "music-mob",
    name: "MUSIC MOB",
    category: "Cultural",
    number: "05",
    tagline: "One campus. One beat. Every voice turned up.",
    description:
      "An evening of songs with your favourite people. Sing together, enjoy the vibe, share some love, and fill every pause with the most brain-rotted conversations. No stage, no pressure, just good music, great company, and memories worth yapping about.",
    format: "Live performance",
    team: "Solo or group",
    duration: "1.5 hours",
    date: "17 · Day 2",
    time: "2 PM – 3:30 PM",
    venue: "Maggie Point",
    accent: "#ff3cac",
    image: musicImage,
    hideCriteria: true,
    challenges: ["Stage presence", "Musicality", "Audience connection"],
    noRegistration: true,
  },
  {
    slug: "dandiya-night",
    name: "DANDIYA NIGHT",
    category: "Cultural",
    number: "06",
    tagline: "Grab your sticks. The campus becomes one big garba circle.",
    description:
      "An open evening of dandiya and garba under the festival lights. Come dressed in colour, join the circle, and dance with your friends till the last beat. Open only to MVSR College students, with registration done on campus at college.",
    format: "Open dance night",
    team: "MVSR College students only",
    teamLabel: "Open to",
    duration: "3 hours",
    date: "17 · Day 2",
    time: "6 PM – 9 PM",
    accent: "#ff9f1c",
    image: dandiyaImage,
    hideCriteria: true,
    challenges: ["Traditional wear", "Bring your dandiya sticks", "Dance till the last beat"],
    registerAt: "On campus at MVSR",
    feeLabel: "Entry fee",
  },
  {
    slug: "standup-comedy",
    name: "STANDUP COMEDY",
    category: "Fun",
    number: "07",
    description:
      "An afternoon of pure Telugu comedy about engineering life. Mid exams, sem results, endless one-side batting, girlfriend drama, trips that never leave the group chat, and amma's phone calls. Every joke lands in Telugu, so grab your gang and get ready to laugh till your stomach hurts.",
    format: "Open mic",
    team: "Individual",
    duration: "1 hr 15 min",
    date: "17 · Day 2",
    time: "12:45 PM – 2 PM",
    venue: "CSE Seminar Hall",
    fee: "₹299",
    accent: "#ffd43b",
    image: comedyImage,
    imagePosition: "68% 0%",
    cardImage: publicUrl("/gallery/standup-comedy-home-right.jpg"),
    performer: { name: "Venkat Blaze", handle: "venkatt_blaze", instagram: "https://www.instagram.com/venkatt_blaze/", bio: "Telugu stand-up comic bringing his sharpest, most relatable sets live to the MVSR stage." },
    hideCriteria: true,
    challenges: ["Originality", "Timing", "Audience response"],
  },
  {
    slug: "recreation-creative",
    name: "RECREATION & CREATIVE EVENTS",
    category: "Fun",
    number: "08",
    tagline: "Play, make, remix, repeat.",
    description:
      "Engineering isn't only about labs, assignments and exams. Grab your friends, drop the books for a while, and dive into games, paint, laughs and a little friendly rivalry. These are the moments you'll still be talking about long after the sem results are forgotten.",
    format: "Drop-in arena",
    team: "Open",
    duration: "4 hours",
    date: "17 · Day 2",
    time: "10 AM – 2 PM",
    venue: "CSE Block Front Space\nCS-09, 11, 12, 13 (4 classrooms)",
    accent: "#ff7a00",
    image: recreationImage,
    activities: ["Sherlock", "Face & Hand Painting", "Hold the Bar", "Giant Jenga"],
    activitiesNote: "More events will be announced soon",
    hideCriteria: true,
    challenges: ["Rapid challenges", "Creative stations", "Team games"],
    noRegistration: true,
    entry: "Walk in",
  },
]

export const categories: EventCategory[] = [
  "Technical",
  "Semi-Technical",
  "Cultural",
  "Fun",
]
