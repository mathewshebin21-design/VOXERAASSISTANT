// Ready-made starting points for a type of business: a typical service menu (lengths and
// "from" prices), opening hours and the house policies the receptionist quotes to callers.
// The owner always sees a template before it is saved and can edit every part afterwards.
// Prices are typical UK high-street rates for 2026; city-centre and premium shops charge more.

import type { Week } from "./parse";

export interface TemplateService {
  name: string;
  category: string;
  duration_min: number;
  /** Clean-down time after the appointment, kept free by the booking engine. */
  buffer_min: number;
  price_from_pence: number;
}

export interface BusinessTemplate {
  sector: string;
  label: string;
  services: TemplateService[];
  week: Week;
  /** Saved as the business description, which the receptionist reads to answer questions. */
  description: string;
}

const s = (category: string, name: string, duration_min: number, pounds: number, buffer_min = 5): TemplateService =>
  ({ name, category, duration_min, buffer_min, price_from_pence: Math.round(pounds * 100) });

const HAIRCUTS = "Haircuts";
const BEARD = "Beard & shaving";
const COMBOS = "Combos";
const EXTRAS = "Extras";

export const BARBERSHOP: BusinessTemplate = {
  sector: "barbershop",
  label: "Barbershop",
  services: [
    s(HAIRCUTS, "Classic men's cut", 30, 20),
    s(HAIRCUTS, "Skin fade", 45, 24),
    s(HAIRCUTS, "Low, mid or high fade", 40, 22),
    s(HAIRCUTS, "Taper fade", 35, 22),
    s(HAIRCUTS, "Scissor cut", 45, 26),
    s(HAIRCUTS, "Clipper cut (one grade all over)", 20, 12),
    s(HAIRCUTS, "Long hair cut or restyle", 60, 30),
    s(HAIRCUTS, "Kids' cut (under 12)", 25, 14),
    s(HAIRCUTS, "Senior cut (65+)", 30, 15),
    s(HAIRCUTS, "Student cut", 30, 16),
    s(HAIRCUTS, "Flat top or high-top", 45, 25),
    s(BEARD, "Beard trim and shape", 20, 10),
    s(BEARD, "Beard sculpt and line-up", 25, 15),
    s(BEARD, "Hot towel cut-throat shave", 40, 22),
    s(BEARD, "Head shave", 30, 18),
    s(BEARD, "Line-up / edge-up", 15, 8),
    s(BEARD, "Beard colour", 20, 15),
    s(COMBOS, "Cut and beard trim", 50, 30),
    s(COMBOS, "Fade and hot towel beard sculpt", 60, 38),
    s(COMBOS, "Father and son (adult and kids' cut)", 50, 32),
    s(COMBOS, "The Works (cut, hot towel shave, wash, mask, style)", 90, 50),
    s(EXTRAS, "Hair wash and style", 10, 5, 0),
    s(EXTRAS, "Hair design / razor pattern", 15, 5, 0),
    s(EXTRAS, "Eyebrow tidy", 10, 5, 0),
    s(EXTRAS, "Nose and ear wax", 10, 8, 0),
    s(EXTRAS, "Face mask", 15, 8, 0),
    s(EXTRAS, "Grey blending or hair colour", 45, 20),
    s(EXTRAS, "Perm or texturising", 90, 50),
    s(EXTRAS, "Scalp treatment", 20, 10, 0),
  ],
  week: [
    [{ opens: "09:00", closes: "19:00" }],
    [{ opens: "09:00", closes: "19:00" }],
    [{ opens: "09:00", closes: "19:00" }],
    [{ opens: "09:00", closes: "20:00" }],
    [{ opens: "09:00", closes: "19:00" }],
    [{ opens: "08:30", closes: "17:00" }],
    [{ opens: "10:00", closes: "16:00" }],
  ],
  description: [
    "We're a barbershop offering men's and kids' haircuts, fades, beard trims, hot towel shaves and grooming extras.",
    "",
    "Booking: appointments come first. Walk-ins are welcome when a chair is free, but booking is the only way to guarantee a time. Callers can ask for a specific barber.",
    "Prices: the prices quoted are starting prices. Long or thick hair, big restyles and designs can cost more; the barber confirms before starting. Senior and master barbers may charge a little more than junior barbers.",
    "Late arrivals: we hold the appointment for 10 minutes. After that we may need to shorten the service or move the booking.",
    "Cancellations: please give at least 24 hours' notice. Missed appointments without notice may be charged 50% of the service.",
    "Deposits: none for haircuts. Longer services (The Works, colour, perms) may need a deposit to secure the booking.",
    "Payment: card, contactless, Apple Pay and Google Pay. Tips are optional and always appreciated.",
    "Kids: children under 12 should come with an adult.",
    "Reference photos: clients are welcome to bring a photo of the style they want.",
    "Products: we sell styling products and beard care (pomade, clay, matte paste, beard oil and balm).",
    "Anything not covered here (parking, accessibility, a particular barber's days off): take a message and the team will call back.",
  ].join("\n"),
};

export const TEMPLATES: BusinessTemplate[] = [BARBERSHOP];

export const templateFor = (sector: string | null | undefined): BusinessTemplate | null =>
  TEMPLATES.find((t) => t.sector === sector) ?? null;
