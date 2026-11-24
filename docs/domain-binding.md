# Production domain binding

Live URL: https://increasevideoquality.com
Registrar: Spaceship. Cloudflare zone: 79c52dbdcc7b0d579d16f654b0abb683.
Worker version: 9a47bdba-631f-428d-a1e6-1167f8909647.

## DNS and HTTPS

- Spaceship had zero custom DNS records. Cloudflare imported two registrar
  parking A records: 54.149.79.189 and 34.216.117.25 (proxied). They remain
  unchanged. No mail records were removed or added.
- Nameservers are now ada.ns.cloudflare.com and rick.ns.cloudflare.com.
- Prepared DNSSEC on the new, non-authoritative Cloudflare zone, then saved
  its public DS in Spaceship's custom-nameserver preparation section BEFORE
  switching nameservers. Spaceship applied the prepared DS during the switch.
  DNSSEC was not disabled.
- Public DS: 2371 13 2 C9276CBC3417C647BEC596ABB9856079FE654EA403897CA9CE90F37F68E198AD.
- Cloudflare reports zone active and DNSSEC successful. Universal SSL is valid.
  HTTP apex redirects to HTTPS (301).

## Application routing

cloudflare.config.ts declares a fetch trigger for increasevideoquality.com/*
on the existing proxied DNS. The Worker handles all paths and does not fetch
its parking origin. Keep this route when redeploying; removing it would expose
the previous registrar parking destination. workersDev remains enabled.

APP_URL is https://increasevideoquality.com. Google OAuth already had the exact
production callback /auth/google/callback, authorized domain, homepage, privacy
and terms URLs. Local and workers.dev callbacks remain. R2 CORS already allows
the production origin; the bucket stays private.

Google OAuth remains in testing mode. This task did not change OAuth publishing
status, run real login/video jobs, reset credits or enable Stripe payments.

## Verification

- pnpm lint, pnpm build, pnpm build:vinext passed.
- SSR check against production origin: 11/11 passed.
- check-cloudflare.mjs with production origin passed, including auth entry,
  Secure/HttpOnly cookie, correct callback, unauthenticated API denial,
  missing result 404 and video sample delivery.
- HTTP apex: 301. HTTPS apex and workers.dev fallback: 200.
- Edge displayed the production homepage. Task tab closed.
- Evidence: domain-live-ssr.txt, domain-live-smoke.txt,
  domain-spaceship-dns.png, domain-cloudflare-dnssec.png,
  domain-live-homepage.png.

## Approval and deployment notes

Automatic review initially rejected DNSSEC enabling without a recorded DS
rollover plan. Read-only checks established the new zone was not authoritative;
the explicit registrar preconfiguration workflow above resolved that concern.
Cloudflare dashboard was used because existing Wrangler OAuth lacks zone-create
and DNS-management API permissions.

A first custom-domain deployment conflicted with imported apex A records.
Automatic review also rejected replacing a parking A record with a placeholder
IP; that edit was never saved. The final deployment uses the supported Worker
route over existing proxy records, without deleting or replacing those records.
