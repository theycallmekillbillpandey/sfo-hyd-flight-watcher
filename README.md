# SFO ↔ HYD Flight Watcher — one-month $25-first deployment

**Independent of ChatGPT.** GitHub Pages hosts the website, Cloudflare Worker serves flight-price requests, Cloudflare Cron runs automatic checks every 12 hours, Cloudflare KV holds search counters and alerts, and Twilio WhatsApp sends alerts. A Cloudflare account, SerpApi key, and an approved Twilio WhatsApp sender/template are required; this ZIP has **not** been deployed to your accounts or tested against live paid flight data.

## Trip and alerts
- Outbound: SFO–HYD, depart **December 11–25, 2026**.
- Return: HYD–SFO, depart **January 14–17, 2027**.
- Economy, one adult, Air India excluded including operating segments, maximum 35 hours each way.
- Only these 12 airlines may appear in an itinerary: Qatar Airways (QR), Emirates (EK), Singapore Airlines (SQ), Cathay Pacific (CX), Lufthansa (LH), British Airways (BA), KLM (KL), Etihad Airways (EY), Turkish Airlines (TK), United Airlines (UA), Virgin Atlantic (VS), Swiss International Air Lines (LX). Air India is excluded on every segment. Where the data provider does not disclose the actual operating carrier, it cannot be independently confirmed.
- Notify on verified observed fare **below $1,500**, or at least **$100 lower** than a prior comparable observed itinerary (same dates, carriers, and direction durations).
- Monitoring scheduled twice daily, and automatically **stops after November 27, 2026 (UTC)**. Edit `STOP_AFTER_DATE` to change it.

## Budget-first settings
The live SerpApi Starter plan advertised on 2026-10-27 is $25/month with 1,000 searches. This project defaults to a best-effort **1,000 provider-request/month ceiling**, split **900 automatic / 100 manual**. Each cron run handles up to 8 date pairs and up to 15 provider calls, rotating through all 60 pairs. **This is not full 60-pair coverage every 12 hours.** The page shows the latest batch size and consumed search credits. Automated coverage is dependent on how many outbound choices the provider returns, the quota, and any errors.

**IMPORTANT BILLING WARNING:** Cloudflare KV is eventually consistent, not atomic. Counters are a useful safeguard, **NOT a guaranteed hard dollar cap** under concurrent requests. Use SerpApi's provider-side search allowance, disable overages if supported, and cap/remove your subscription in the SerpApi billing dashboard. Your SerpApi subscription does not automatically cancel because this tracker stops checking.

## Deploy: one time
1. Create GitHub repo and enable **Settings > Pages > Deploy from branch > main, /(root)**. Upload `index.html`, `config.js` and optionally this README (worker files can also live in the same repository).
2. Create Cloudflare account, create a SerpApi account and select an appropriate plan, create a Twilio WhatsApp sender, obtain recipient opt-in, and approve an out-of-session WhatsApp Content Template with seven sequential variables. Keep all secrets private.
3. Edit `worker/wrangler.toml`: replace `ALLOWED_ORIGIN` with your actual Pages origin, e.g. `https://YOURNAME.github.io` (not the repo-specific path). Review `STOP_AFTER_DATE` and allowance variables. The schedule is 00:00 and 12:00 **UTC**.
4. In a terminal with Node.js installed:

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create FARE_STORE
```

5. Copy KV namespace ID printed by the command. Uncomment the `[[kv_namespaces]]` lines in `worker/wrangler.toml` and enter the ID. Then:

```bash
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_WHATSAPP_FROM
npx wrangler secret put ALERT_WHATSAPP_TO
npx wrangler secret put TWILIO_CONTENT_SID
npx wrangler deploy
```

6. Replace the placeholder in root `config.js` with the worker `https://...workers.dev` address from deployment. Commit/push changes to GitHub. Visit the GitHub Pages URL and use **Check flights now**. The backend rotates scheduled checks even when the website is closed.
7. Verify in Cloudflare **Workers & Pages > your Worker > Settings > Triggers** that the Cron Trigger is installed, then check your Worker logs/status after it fires. Test a WhatsApp notification by creating a monitored offer below threshold with a test API response (do not assume a test response is a real fare).

## Technical and coverage limitations
- An interactive **Check flights now** will stop automatically when the manual allowance (100 requests/month) is exhausted. It will generally be unable to cover all 60 pairs in a month alongside frequent rechecks; this is intentional for $25-first monitoring.
- One round-trip result typically requires an outbound and another return-selection provider call. We inspect up to 3 eligible outbound options per date pair (subject to per-run allowance). We do not guarantee absolute cheapest fares or coverage of every carrier.
- Flight links point to date-based Google Flights searches, not to a locked-in booking checkout. Verify fare and segment operators before buying.
- The Worker checks Origin headers for ordinary browser calls. This is **not robust authentication or a hard abuse defense**. Because the repository is public, use Cloudflare rate limiting/access controls or a private authentication scheme to deter third-party calls if broad exposure matters.
- SerpApi pricing, APIs, and Cloudflare free-tier limits can change. Only fake responses were used to test the integration. Complete deployment and live API verification are still required.
- **Monthly usage counters reset on the first day of each UTC month**, not after exactly 30 days. The monitoring stop date is independent of this reset.

## Tests
From the project root, run: `node --test tests/*.test.js` (11 local tests). They cover date generation, airline/duration exclusions, mocked two-stage Google Flights search, budget exhaustion, origin rejection, and monitoring expiry.

## WhatsApp template setup
Use Twilio Content Template Builder and submit a WhatsApp-approved template. Example template:

> Flight fare alert: {{1}} round trip. Carriers: {{2}}. Depart SFO: {{3}}. Depart HYD: {{4}}. Outbound duration: {{5}}. Return duration: {{6}}. Check this itinerary: {{7}}. Fares may change.

Set `TWILIO_CONTENT_SID` to its `HX...` identifier. Set `TWILIO_WHATSAPP_FROM` and `ALERT_WHATSAPP_TO` to WhatsApp-enabled E.164 phone numbers (such as `+1...`), using Cloudflare secrets, not source files. An approved template, production-enabled sender, and opted-in recipient are necessary for unsupervised 12-hour notifications. The sandbox is for testing and not equivalent to a production sender. Twilio/Meta messaging fees are separate from SerpApi's $25 subscription.

**Important:** This integration is mocked in automated tests. No live WhatsApp message, live fare quote, or hosted Cloudflare deployment has been verified without account credentials.
