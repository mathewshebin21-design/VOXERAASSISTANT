// Dashboard templates by type of business. The same call data drives every template;
// what changes is the vocabulary (appointments vs jobs vs reservations…), which panels
// lead, and which figures are headlined, so each business sees what matters to it first.

export type DashboardId = "salon" | "clinic" | "trades" | "hospitality" | "professional" | "fitness" | "general";
export type WidgetId = "live" | "kpis" | "summary" | "attention" | "desk" | "flows" | "daily" | "peak" | "sentiment";
export type KpiId = "answered" | "conversion" | "booked" | "handoffs" | "messages" | "cost" | "unhappy" | "afterHours";

export interface Terms { booking: string; bookings: string; customer: string; customers: string; book: string }

export interface DashboardTemplate {
  id: DashboardId;
  label: string;
  examples: string;
  focus: string;
  terms: Terms;
  kpis: [KpiId, KpiId, KpiId, KpiId];
  /** Panels in display order (pairs are laid out side by side). */
  widgets: WidgetId[];
}

const t = (booking: string, customer: string, book = "booked"): Terms => ({ booking, bookings: `${booking}s`, customer, customers: `${customer}s`, book });

export const DASHBOARDS: DashboardTemplate[] = [
  { id: "salon", label: "Salon & beauty", examples: "Hair, barbers, nails, beauty, aesthetics, spa", focus: "Bookings won, hand-offs and the live call",
    terms: t("appointment", "client"), kpis: ["answered", "conversion", "handoffs", "cost"], widgets: ["live", "kpis", "summary", "attention", "flows", "daily"] },
  { id: "clinic", label: "Clinic & therapy", examples: "Physio, dental, osteopath, vets, therapists", focus: "What needs a person first: escalations, callbacks and unhappy callers",
    terms: t("appointment", "patient"), kpis: ["answered", "booked", "messages", "unhappy"], widgets: ["attention", "desk", "kpis", "summary", "daily", "sentiment"] },
  { id: "trades", label: "Trades & home services", examples: "Plumbers, electricians, cleaners, locksmiths, garages", focus: "Never miss a job: callers waiting, out-of-hours calls and busy times",
    terms: t("job", "customer", "booked in"), kpis: ["answered", "booked", "afterHours", "messages"], widgets: ["desk", "kpis", "attention", "peak", "daily", "summary"] },
  { id: "hospitality", label: "Restaurant & hospitality", examples: "Restaurants, cafés, pubs, B&Bs, venues", focus: "Reservations taken and when the phone rings most",
    terms: t("reservation", "guest", "reserved"), kpis: ["answered", "booked", "conversion", "afterHours"], widgets: ["kpis", "peak", "daily", "summary", "flows", "attention"] },
  { id: "professional", label: "Professional services", examples: "Solicitors, accountants, estate agents, consultants", focus: "New enquiries, consultations and callbacks owed",
    terms: t("consultation", "client"), kpis: ["answered", "booked", "messages", "handoffs"], widgets: ["attention", "kpis", "desk", "summary", "sentiment", "flows"] },
  { id: "fitness", label: "Gym & fitness", examples: "Gyms, studios, personal trainers, classes", focus: "Class and session bookings, and peak enquiry times",
    terms: t("session", "member"), kpis: ["answered", "conversion", "booked", "cost"], widgets: ["kpis", "daily", "peak", "summary", "flows", "attention"] },
  { id: "general", label: "General business", examples: "Anything else that takes calls and bookings", focus: "A balanced overview",
    terms: t("appointment", "customer"), kpis: ["answered", "conversion", "handoffs", "messages"], widgets: ["live", "kpis", "summary", "attention", "desk", "daily"] },
];

/** Business sectors stored on the workspace profile, and the dashboard each one uses. */
export const SECTORS: { value: string; label: string; dashboard: DashboardId }[] = [
  { value: "hair_beauty", label: "Hair & beauty", dashboard: "salon" },
  { value: "aesthetics", label: "Aesthetics (non-clinical)", dashboard: "salon" },
  { value: "wellness", label: "Wellness & spa", dashboard: "salon" },
  { value: "clinic", label: "Clinic & therapy", dashboard: "clinic" },
  { value: "trades", label: "Trades & home services", dashboard: "trades" },
  { value: "hospitality", label: "Restaurant & hospitality", dashboard: "hospitality" },
  { value: "professional", label: "Professional services", dashboard: "professional" },
  { value: "agency", label: "Agency", dashboard: "professional" },
  { value: "fitness", label: "Gym & fitness", dashboard: "fitness" },
  { value: "other", label: "Other", dashboard: "general" },
];

export const dashboardFor = (sector: string | null | undefined): DashboardTemplate =>
  DASHBOARDS.find((d) => d.id === (SECTORS.find((s) => s.value === sector)?.dashboard ?? "general")) ?? DASHBOARDS[DASHBOARDS.length - 1];

export const dashboardById = (id: DashboardId | null | undefined): DashboardTemplate | null => DASHBOARDS.find((d) => d.id === id) ?? null;

/** The sector to save when someone picks a dashboard directly. */
export const sectorFor = (id: DashboardId): string => ({ salon: "hair_beauty", clinic: "clinic", trades: "trades", hospitality: "hospitality", professional: "professional", fitness: "fitness", general: "other" })[id];
