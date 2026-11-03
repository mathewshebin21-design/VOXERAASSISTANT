# Practice receptionist (Simulate) and a more natural browser voice

## What changed
- **Signed in, Simulate uses your workspace.** The free practice receptionist answers from the signed-in
  workspace's real details: services (name, duration, starting price, patch test), opening hours, address,
  phone, email and website. It finds times from the API's real availability (`GET /orgs/{id}/availability`).
  Code: `apps/previews/src/lib/live/practice.ts` and `practice-catalog.ts`. Signed out, or exploring the
  demo, it still uses the demo salon.
- **It answers the question that was asked.** Questions are handled before the booking flow, wherever the
  caller is in a booking. Examples: "what services do you offer?", "what's a skin fade?", "how much is…",
  "how long does…", "are you open Sunday?", "where are you?", "do you do X?". After answering, it picks the
  booking back up ("Shall I look for a time for your skin fade?"). Before, it moved on to offering times.
  If the caller's words match more than one service ("a cut"), it asks which one instead of guessing.
  If something isn't on the list, it says so plainly. For anything it can't answer, it offers to put the
  caller through.
- **Demo salon fixes.** The demo receptionist now explains services when asked ("What's a bond repair
  treatment?"). It lists all services, asks which colour service the caller means, and no longer says
  "Happy to help. Happy to help you book."
- **More natural voice.** `src/lib/voice/natural.ts`:
  - picks the most natural installed browser voice. Neural, "Natural", "Enhanced" and "Premium" voices
    come first, then well-known Apple, Google and Microsoft voices. Novelty and "compact" voices are
    never picked.
  - reads text the way a person would: "14:30" becomes "half past two", and dashes become pauses.
  - is used by the simulators and the Voice lab's browser voice. Simulate shows which voice it is using.

## Two brains: Claude when it's on, the free one otherwise

**Claude.** When the workspace has Claude switched on (`VOXERA_ANTHROPIC_API_KEY` and the monthly caps set on the `voxera-api` project; see `docs/phase-3-live-providers.md`), Simulate uses the same Claude receptionist as the Voice lab. That is what makes it talk like a person: it answers anything sensibly, follows the conversation, and still only states facts from the workspace's own services, hours and details. Each message counts against the workspace's monthly AI allowance. If Claude is unavailable (cap reached, switched off, or the user can't edit agents), the call carries on with the free brain and says so. The page shows which brain is answering.

**The free brain.** It's rule-based and costs nothing. It now also handles everyday conversation instead of saying "good question" to everything:

- Casual greetings ("heyy", "hiii", "yo", "hey there", "good morning!") and "how are you?".
- A greeting and a question together: "hi, how much is a skin fade?" gets "Hi! Skin fade starts from…".
- "What do you know?", "what can you do?", "who are you?" and "are you a robot?" get a short introduction with what it can actually help with.
- Off-topic chat (weather, jokes) gets a friendly "I'm just the receptionist…", and "ok", "hmm" and "thanks" get natural replies.
- A message it doesn't follow gets "Sorry, I didn't quite follow that" plus what it can do. It offers a person only on the second miss, or for a real question it can't answer.

The production `voxera-api` project has no Claude key yet, so the live site uses the free brain until one is added.

## Limits (honest)
- This is still a **rule-based** practice receptionist. It covers common receptionist questions well, but
  it is not a language model. Fully natural understanding of any wording comes from the Claude-powered
  receptionist (`/live/brain`). That needs an Anthropic API key and spending caps on the API. Both are
  paid and need the owner's approval.
- Practice bookings are **not** written to the real diary, and transfers place no real call. The chat
  says so.
- The browser voice depends on the voices installed on the device. On iPhone, download a better voice
  under Settings → Accessibility → Spoken Content → Voices (pick an "Enhanced" or "Premium" English
  voice). On Windows/Edge, the "Online (Natural)" voices are used automatically. The Voice lab also
  offers Kokoro (on-device neural voice, free) and ElevenLabs (paid, needs a key).

## Tests
- `src/lib/live/practice.test.ts`:
  - workspace service listing, explaining a service mid-booking, choosing between services;
  - real-availability booking with confirmation;
  - hours, address, price, duration and "not offered" answers, and handover;
  - natural voice selection and spoken times.
- `src/lib/simulator.test.ts`: the demo screenshot case ("Treatment" → "What's a bond repair
  treatment?"), service listing, colour choice.
- `scripts/e2e-designs-live.mjs` (13/13): Flow Simulate against the API answers with the workspace's
  own services and offers real times.
