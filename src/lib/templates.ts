import type { FieldType, FormDefinition, FormField } from "./shared";

export const uid = () => Math.random().toString(36).slice(2, 10);

export const FIELD_LABELS: Record<FieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  number: "Number",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  rating: "Rating",
  consent: "Marketing consent",
};

export function newField(type: FieldType): FormField {
  const base: FormField = { id: uid(), type, label: FIELD_LABELS[type], required: false };
  if (type === "single_choice" || type === "multiple_choice") base.options = ["Option A", "Option B"];
  if (type === "rating") base.max_rating = 5;
  if (type === "email") base.label = "What's your email?";
  if (type === "consent") {
    base.label = "Yes, send me occasional product news. I can unsubscribe anytime.";
    base.consent_version = "v1";
  }
  return base;
}

const f = (type: FieldType, label: string, extra: Partial<FormField> = {}): FormField => ({
  ...newField(type),
  label,
  ...extra,
});

export interface Template {
  id: string;
  name: string;
  blurb: string;
  build: () => FormDefinition;
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank form",
    blurb: "Start from an empty canvas.",
    build: () => ({ title: "Untitled form", description: "", capture_contact: false, fields: [], theme: { accent: "orange" } }),
  },
  {
    id: "lead",
    name: "Lead generation",
    blurb: "Qualify inbound interest and capture consent.",
    build: () => ({
      title: "Let's talk about your project",
      description: "A few quick questions so we can follow up properly.",
      capture_contact: true,
      theme: { accent: "orange" },
      fields: [
        f("short_text", "What's your name?", { required: true }),
        f("email", "Where can we reach you?", { required: true }),
        f("single_choice", "Team size", { options: ["Just me", "2–10", "11–50", "50+"], required: true }),
        f("long_text", "What are you hoping to achieve?"),
        f("consent", "Yes, email me occasional updates. I can unsubscribe anytime."),
      ],
    }),
  },
  {
    id: "feedback",
    name: "Customer feedback",
    blurb: "Rating, likes and gaps in under a minute.",
    build: () => ({
      title: "How are we doing?",
      description: "Your honest feedback shapes what we build next.",
      capture_contact: false,
      theme: { accent: "olive" },
      fields: [
        f("rating", "How likely are you to recommend us?", { required: true, max_rating: 10 }),
        f("multiple_choice", "What do you use most?", { options: ["Forms", "Contacts", "Campaigns", "Agent access"] }),
        f("long_text", "What should we improve?"),
      ],
    }),
  },
  {
    id: "event",
    name: "Event registration",
    blurb: "Collect attendees, sessions and consent.",
    build: () => ({
      title: "Register for the workshop",
      description: "Seats are limited — we'll confirm by email.",
      capture_contact: true,
      theme: { accent: "plum" },
      fields: [
        f("short_text", "Full name", { required: true }),
        f("email", "Email", { required: true }),
        f("single_choice", "Which session?", { options: ["Morning", "Afternoon"], required: true }),
        f("number", "How many seats?", { required: true }),
        f("consent", "Keep me posted about future events. I can unsubscribe anytime."),
      ],
    }),
  },
];

export const ACCENTS = ["orange", "charcoal", "olive", "plum", "teal"] as const;
