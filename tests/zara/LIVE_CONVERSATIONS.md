# Zara — live-agent conversation scripts (manual L4 verification)

The `zara-run.mjs` suite proves the **rules and CRM contract** automatically. This
file is for the other half of L4: verifying the **live agent** behaves as documented.
Open the Zara chat (the DSH web GUI in this workspace, or the WhatsApp bridge) and run
each transcript, then tick the expected outcome.

## scn-01 · Lahore surgical 75/25 (WhatsApp, EN)

```
Patient: Hello! I want a hair transplant. My name is Ahmed, my number is 0300 1234547
Patient: I'm in Lahore
```
- [ ] Zara greets as **Zara**, warm, one question at a time
- [ ] Lead created: full_name=Ahmed, mobile `+923001234547`, city Lahore, source whatsapp
- [ ] Branch = **12-K Gulberg (LHR-12K)** — last two digits 47 → 47 % 4 = 3 → the 25% bucket
- [ ] Repeat with a number ending **42** → branch = **Young Again (LHR-YA)** (75% bucket)

## scn-02 · Karachi surgical 65/35 (WhatsApp, EN)

```
Patient: I'm in Karachi and interested in FUE. My number is 0300 1234507
```
- [ ] Branch = **SMCHS (KHI-SM)** — 07 % 20 = 7 < 13 → 65% bucket
- [ ] Repeat with a number ending **19** → branch = **Park Tower (KHI-PT)** (35% bucket)

## scn-03 · Karachi PRP → SMCHS (WhatsApp, UR)

```
Patient: السلام علیکم! مجھے PRP کروانا ہے، کراچی سے ہوں
Patient: Bilal Khan, 0300 1234547
```
- [ ] Zara replies in **Urdu**
- [ ] Lead routes to **SMCHS (KHI-SM)** regardless of phone digits (PRP 100%)

## scn-04 · Non-surgical hubs (web chat, EN)

```
Patient: Hi, I need a hair system. I'm in Lahore.
```
- [ ] Routes to **12-K Gulberg (LHR-12K)** · Karachi → **Park Tower** · Islamabad → **Beverley**
- [ ] Any other city (e.g. Multan) → that city's branch (**MUX-01**)

## scn-05 · Islamabad surgical 75/25 (WhatsApp, EN)

```
Patient: Islamabad, transplant please. 0300 1234543
```
- [ ] Branch = **Beverley (ISB-BV)** (43 % 4 = 3) — ending **42** → **D Chowk (ISB-DC)**

## scn-06 · Missing data + follow-up (WhatsApp, EN)

```
Patient: Hi, my name is Zain and my number is 0300 1234542. I want a transplant.
```
- [ ] Zara asks for the city **once**, then stops (no question spam)
- [ ] After 24h: exactly ONE gentle follow-up, then a second at 48h, then "marked low" at 72h
- [ ] Lead stays `new`, city empty until provided

## scn-07 · Auto-booking (WhatsApp, EN)

```
Patient: Booking a consultation please. Usman, Lahore, 0300 1234542
```
- [ ] Zara offers **3 free slots** from the availability check (node _availability.cjs)
- [ ] On selection, booking lands on the calendar; consultant notified; lead → consult_booked
- [ ] Booking the SAME slot again → Zara apologises and offers the next free slot

## Pricing guardrail (any channel)

```
Patient: kitna hai? / how much is a hair transplant?
```
- [ ] Answer is directional only: "starts from Rs. 150,000/-", factors listed, redirect to the consultant
- [ ] NEVER a firm price, NEVER another clinic's price

## Persona checks (any channel)

- [ ] "Who is Dr Nasir?" → concise answer from the profile; no invented credentials
- [ ] WhatsApp replies stay 1–2 sentences (brevity rule); voice note → "please type or send a photo"
