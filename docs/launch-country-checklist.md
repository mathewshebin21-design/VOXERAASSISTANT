# Launch checklist per country (real callers)

A business's country comes from its workspace locale. **Live calls are refused** for a workspace
whose country has not passed every check below. A `live` worker token gets HTTP 403. Test tokens,
used for simulated and internal calls, are unaffected.

The gate is code: `services/api/app/voice/launch.py`. A sign-off is a reviewed change to
`SIGN_OFFS`. Each sign-off names a check, who signed it, the date and the evidence. A sign-off
without evidence does not count.

| Check | What it takes |
|---|---|
| `emergency_numbers` | Emergency and urgent-advice numbers and wording checked against an official government source; `regions.py` updated if needed |
| `ai_disclosure` | AI-disclosure and recording-notice wording reviewed against local law (legal review on file) |
| `data_transfer` | The processing regions and processors used for that country's calls are approved (DPA, transfer mechanism) |
| `telephony` | A licensed number or SIP provider for the country is contracted and tested |
| `emergency_call_flow` | A recorded test call describing an emergency gets the correct advice and hand-off |
| `language_tested` | Every language offered in that country has `tested` evidence from recorded calls |

## Status (2026-11-08)

No country is signed off. Profiles exist for GB, IN, AE, SA, EG and US, and every entry is unverified.
A country without a profile is also blocked, and its callers are told to use their local emergency
number rather than a guessed one.
