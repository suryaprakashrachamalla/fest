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
  // Omitted for events with no team format; the Team row is then hidden.
  team?: string
  duration: string
  date: string
  time: string
  venue?: string
  fee?: string
  // Registration offers a "Team code" box (₹50 off with a code made for this event).
  teamCodes?: boolean
  // Label for the fee row, e.g. "Entry fee"; defaults to "Fee".
  feeLabel?: string
  // Event coordinators shown on the event page; phone is a 10-digit Indian mobile number.
  coordinators?: { name: string; phone: string }[]
  // Also show the fee in the event page hero (for events without a prize pool).
  heroFee?: boolean
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
  // Sign-up links for single activities (e.g. a Google Form), shown as a Register button next to them.
  activityLinks?: Record<string, string>
  activitiesNote?: string
  // Performance nights skip the judging criteria section.
  hideCriteria?: boolean
  // Walk-in events show their details only, with no register buttons.
  noRegistration?: boolean
  // Shown in the Hotspot block above all categories (with this badge) instead of under its category.
  hotspot?: string
  // Overrides the walk-in entry text shown in the facts.
  entry?: string
  // Events registered for in person on campus: no online button, shown in the facts instead.
  registerAt?: string
  // External sign-up (e.g. a Google Form) opened by the Register button instead of the site's own form.
  registerUrl?: string
  // How to get an entry pass, shown as numbered steps under the Register button.
  passSteps?: { title: string; steps: string[]; closing?: string }
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
    teamCodes: true,
    coordinators: [{ name: "Sana", phone: "9100903450" }, { name: "Aniketh", phone: "8309012359" }],
    name: "VYOM HACKATHON (CSE)",
    hotspot: "Prizes worth ₹4L+",
    category: "Technical",
    number: "01",
    tagline: "Build the impossible before the clock runs out.",
    description:
      "An intense product sprint where teams turn bold ideas into working prototypes. Problem statements will be provided on the spot, with mentor checkpoints along the way and a final jury pitch.",
    format: "Build + pitch",
    team: "2–4 members",
    duration: "24 hours",
    date: "16 & 17 · Day 1 & 2",
    time: "10 AM – 10 AM next day",
    venue: "CSE Labs 2, 3, 4, 5",
    food: "Provided · No extra charge",
    fee: "₹399 / head",
    heroPrize: "₹4L+",
    accent: "#e8ddc4",
    image: techImage,
    criteria: { label: "VYOM HACKATHON domains", title: ["Pick your domain.", "We'll bring the arena."] },
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
    teamCodes: true,
    coordinators: [{ name: "Surya", phone: "8247859699" }, { name: "Zeeshan", phone: "7981084902" }],
    name: "NOCODE VIBEATHON",
    category: "Technical",
    number: "02",
    tagline: "Ship a real idea without writing a line of code.",
    description:
      "NoCode Vibeathon is a three-track rapid prototype challenge for creators who want to build with AI and no-code tools. In each track you get a visual or digital reference, like a photo, a website or an interface, and you build your own version of it with AI-powered and no-code platforms. It's all about creativity, execution and turning inspiration into a working digital experience. You'll get access to Canva Pro and other AI Pro tools to design, automate and launch your ideas. Every track crowns its own winner, and each track winner takes home ₹1,500. The total prize pool is worth ₹30,000+!",
    format: "Prototype sprint",
    team: "1–3 members",
    duration: "6 hours",
    date: "16 · Day 1",
    time: "10 AM – 4 PM",
    venue: "CS-11, 12 (2 classrooms)",
    fee: "₹149 / head",
    prize: "Worth ₹30,000+",
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
    coordinators: [{ name: "Archita", phone: "9849112021" }],
    name: "SYSTEM DESIGN AND GITHUB WORKSHOP",
    category: "Technical",
    number: "03",
    tagline: "From first commit to confident collaboration.",
    description:
      "A hands-on workshop covering repositories, branches, pull requests, issues, and the habits that make open-source collaboration feel effortless, plus the fundamentals of system design.",
    format: "Guided workshop",
    team: "Individual",
    duration: "3 hours",
    date: "16 · Day 1",
    time: "2 PM – 5 PM",
    venue: "CSE Seminar Hall",
    fee: "₹99 / head",
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
    coordinators: [{ name: "Lalasa", phone: "7386858392" }],
    name: "PRODUCT-A-THON",
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
    prize: "Worth ₹50,000+",
    accent: "#52e5ff",
    image: productDesignImage,
    challenges: ["Problem framing", "Product thinking", "Final concept pitch"],
  },
  {
    slug: "music-mob",
    coordinators: [{ name: "Eshank", phone: "9642200046" }],
    name: "MUSIC MOB",
    category: "Cultural",
    number: "05",
    tagline: "One campus. One beat. Every voice turned up.",
    description:
      "An evening of songs with your favourite people. Sing together, enjoy the vibe, share some love, and fill every pause with the most brain-rotted conversations. No stage, no pressure, just good music, great company, and memories worth yapping about.",
    format: "Live performance",
    duration: "1.5 hours",
    date: "17 · Day 2",
    time: "11:30 AM – 1 PM",
    venue: "Maggie Point",
    accent: "#ff3cac",
    image: musicImage,
    hideCriteria: true,
    challenges: ["Stage presence", "Musicality", "Audience connection"],
    noRegistration: true,
  },
  {
    slug: "dandiya-night",
    coordinators: [{ name: "Shiva Prasad", phone: "9398468432" }],
    name: "DANDIYA NIGHT",
    category: "Cultural",
    number: "06",
    tagline: "Shouryanga Parvam · Grab your sticks. The campus becomes one big garba circle.",
    description:
      "Shouryanga Parvam brings an open evening of dandiya and garba under the festival lights. Come dressed in colour, join the circle, and dance with your friends till the last beat. Open only to MVSR College students: register through the Google Form, then pay at the offline desk in college to collect your pass.",
    format: "Open dance night",
    team: "MVSR College students only",
    teamLabel: "Open to",
    duration: "3 hours",
    date: "17 · Day 2",
    time: "3:30 PM onwards",
    fee: "₹299",
    heroFee: true,
    accent: "#ff9f1c",
    image: dandiyaImage,
    hideCriteria: true,
    challenges: ["Traditional wear", "Bring your dandiya sticks", "Dance till the last beat"],
    registerAt: "Google Form, then pay at the college desk",
    registerUrl:
      "https://docs.google.com/forms/d/e/1FAIpQLSeAGZVfPqNFuv8Q3t8az5Lh0LV9-geybNjO24mSPsbScWIWwg/viewform?usp=publish-editor",
    passSteps: {
      title: "🎟️ Process to Get Your Dandiya Event Passes",
      steps: [
        "Fill out the Google Form.",
        "Visit the offline desk in the college and complete the required payment.",
        "Collect your pass after payment confirmation.",
        "Bring your pass on the event day for verification and entry. The pass will be verified and stamped by the organizing team.",
      ],
      closing: "✨ Complete all the steps and get ready to dance",
    },
    feeLabel: "Entry fee",
    hotspot: "Selling fast · Limited passes",
  },
  {
    slug: "standup-comedy",
    coordinators: [{ name: "Poorvi", phone: "8341836096" }],
    name: "STANDUP COMEDY",
    hotspot: "Live · Venkat Blaze",
    category: "Fun",
    number: "07",
    description:
      "Get ready for a nostalgic, hilarious Telugu comedy ride through school-day memories, roasting Chota Bheem, the struggles of being single, and the never-ending mission of finding a girlfriend! With relatable stories, unexpected punchlines, and a few twists you won’t see coming, this show promises non-stop laughs from start to finish.",
    format: "Standup comedy",
    team: "Single, or a group of 5",
    teamLabel: "Tickets",
    duration: "1 hr 15 min",
    date: "17 · Day 2",
    time: "12:45 PM – 2 PM",
    venue: "CSE Seminar Hall",
    fee: "₹299 single · ₹999 group of 5",
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
    coordinators: [{ name: "Srusha", phone: "7569101559" }, { name: "Jyotsna", phone: "7842718267" }],
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
    activityLinks: { Sherlock: "https://forms.gle/ijNV3shV51YYwLHcA" },
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
