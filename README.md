# SFO ↔ HYD Flight Watcher — email notification edition

Browser-only Cloudflare Worker + GitHub Pages deployment. **No WhatsApp or Twilio account required.** The Worker calls [Resend](https://resend.com) to email qualifying airline-sold fare alerts.

## Update an existing installation (browser only)
1. In Cloudflare > Workers & Pages > `sfo-hyd-flight-check` > **Edit code**, replace the code with **the complete contents of `worker/index.js` in this ZIP**, and Deploy. This replaces WhatsApp sending with email sending.
2. In your Worker > Settings > Variables and Secrets, add **Secret** `RESEND_API_KEY` (create an API key at https://resend.com/api-keys).
3. Add **Text** `ALERT_EMAIL_TO` with the email address receiving alerts.
4. Add **Text** `ALERT_EMAIL_FROM` with `Flight Watch <onboarding@resend.dev>` for initial testing **to your own Resend account email only**. For unrestricted production sending, verify a domain in Resend and change this to `Flight Watch <alerts@YOURDOMAIN.COM>`.
5. Old `TWILIO_*` and `ALERT_WHATSAPP_TO` secrets can be deleted after email alerts are verified; they are no longer used by this edition.
6. Under Worker > Settings > Triggers > Cron Triggers, **remove old schedules** and add `0 3 * * *` for daily **7 PM PST** during standard time. Cloudflare cron is UTC; **during daylight time use `0 2 * * *` for 7 PM PDT**. No DST-aware cron in this setup, so update the schedule when clocks change.
7. Leave the existing **`FARE_STORE`** KV namespace binding and **`SERPAPI_KEY`** secret in place. The existing GitHub `config.js` URL can stay unchanged because the Worker URL stays the same.
8. Optional dashboard variables: `PAIRS_PER_RUN=60`; `AUTO_CALLS_PER_RUN=30` (the current code *hard-caps per-run requests at 30* even if set higher); `MONTHLY_REQUEST_CAP=1000`; `MANUAL_REQUEST_CAP=100`; `ALERT_PRICE_USD=1500`; `STOP_AFTER_DATE=2026-11-27`; `ALLOWED_ORIGIN=https://YOUR_USERNAME.github.io`. **A value of 60 date pairs does not guarantee all 60 are completed in a run.**
9. Upload updated `index.html` to GitHub Pages and commit. `config.js` is unchanged unless you have a different Worker URL.
10. Verify `notificationConfigured: true` at the website monitoring status, then verify actual email delivery when a *real* qualifying alert occurs. For an immediate delivery test, use Resend's test email tool in its dashboard. This does **not** verify the Worker email pathway; that still needs an integration test with test data before relying on it.

## Trip requirements
Outbound SFO→HYD: Dec 11–25, 2026. Return HYD→SFO: Jan 14–17, 2027. One economy traveler, each direction ≤35h. Allowed carriers: QR, EK, SQ, CX, LH, BA, KL, EY, TK, UA, VS, LX; no Air India. Alerts for airline-sold round-trip price <USD 1500 or drop ≥USD 100 versus previous lowest observed comparable fare. Airline-direct seller must be explicitly flagged by the Google Flights booking response.

## Cost and coverage
Resend currently offers a free tier up to 3,000 emails/month and 100/day. Email volume is normally minimal; the paid cost is for SerpApi searches, not email. This tracker has a **1,000-request/month best-effort software limit**. **Daily full 60-pair checks are impossible within that quota**: at least 1,800 base searches/month, plus more for return and booking-option checks. Worker per-run call cap is internally limited to 30, so it rotates and/or stops early. Counters in KV are non-atomic and not a guaranteed billing limit. Stop date is Nov 27, 2026. Always verify final prices on the airline site. Not live tested without your accounts.

## Note about sender domain
Resend's `onboarding@resend.dev` is for initial testing to your registered email. To send without test-domain restrictions (e.g. to another account), add a verified sending domain in the Resend dashboard; this requires owning/controlling a domain. No WhatsApp approval or Twilio template is needed.
