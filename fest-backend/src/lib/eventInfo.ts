// Schedule, venue and coordinators shown in ticket emails, keyed by event slug.
// Keep in step with src/app/events.ts on the website, which shows the same details.
export type EventInfo = {
    date: string;
    time: string;
    venue: string;
    coordinators: { name: string; phone: string }[];
};

export const EVENT_INFO: Record<string, EventInfo> = {
    hackathon: {
        date: "16 & 17 October 2026",
        time: "10 AM – 10 AM next day",
        venue: "CSE Labs 2, 3, 4, 5",
        coordinators: [
            { name: "Sana", phone: "9100903450" },
            { name: "Aniketh", phone: "8309012359" },
        ],
    },
    "no-code-vibathon": {
        date: "16 October 2026",
        time: "10 AM – 4 PM",
        venue: "CS-11, 12",
        coordinators: [
            { name: "Surya", phone: "8247859699" },
            { name: "Zeeshan", phone: "7981084902" },
        ],
    },
    "github-workshop": {
        date: "16 October 2026",
        time: "2 PM – 5 PM",
        venue: "CSE Seminar Hall",
        coordinators: [{ name: "Archita", phone: "9849112021" }],
    },
    "build-lab": {
        date: "16 October 2026",
        time: "10 AM – 5 PM",
        venue: "CSE Seminar Hall; CS-201, 211, 212, 213",
        coordinators: [{ name: "Lalasa", phone: "7386858392" }],
    },
    "standup-comedy": {
        date: "17 October 2026",
        time: "12:45 PM – 2 PM",
        venue: "CSE Seminar Hall",
        coordinators: [{ name: "Poorvi", phone: "8341836096" }],
    },
};

export function formatPhone(phone: string) {
    return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;
}
