# Public Chapter website

The homepage at `/` is public for anonymous and signed-in visitors. Signed-in visitors receive **Open Dashboard** and workspace CTAs. `/dashboard` checks the existing session on the server before fetching authorized projects. Login, signup, invitations, billing returns, and memory-source links now point to this protected route. Existing `/?project=`, `/?invite=`, and `/?billing=` links redirect to the dashboard and preserve their query information. `/demo` retains the existing example workspace; signed-in real accounts are directed to their dashboard.

The landing page uses Chapter's existing brand, Inter and DM Serif Display fonts, pine-green palette, and an optimized screenshot of the actual anonymous example dashboard. Its navigation and FAQ use native HTML; the page doesn't import the dashboard's client code. Server rendering provides the full content, links, prices, metadata, and structured data without JavaScript. Mobile navigation, focus indicators, skip navigation, and reduced-motion styles are included.

## Production configuration

- Set `NEXT_PUBLIC_SITE_URL=https://onemoreapp.pro` (or your actual production HTTPS origin). It controls the canonical, Open Graph URLs, JSON-LD, robots, and sitemap. It never uses a localhost app origin. The supplied domain is the default, but DNS, domain ownership, and production availability are not established by this change.
- Set `NEXT_PUBLIC_APP_URL` to the deployed app's actual origin for existing auth/integration/billing URLs. These are independent so local development can retain its local URL.
- Set the existing `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and distinct `STRIPE_PRO_PRICE_ID` / `STRIPE_TEAM_PRICE_ID` for checkout. The page retrieves active fixed recurring **licensed** prices from Stripe, with a 3-second timeout and a bounded 5-minute instance cache (30 seconds for failures). It does not invent monthly prices, discounts, or annual plans. Unsupported price models and provider errors show unavailable pricing. Final price and tax remain confirmed at checkout. Currency handling follows [Stripe's charging units](https://docs.stripe.com/currencies).
- `CHAPTER_PLAN_LIMITS` configures the same project, storage, monthly AI-request and seat limits used by server enforcement. Defaults: Free 10 projects / 100 MiB / 10 AI / 2 seats; Pro 100 / 5 GiB / 250 / 5; Team 500 / 25 GiB / 2,000 / 25. Owner seats are included. Invalid limit configuration produces a pricing error, not fabricated limits.
- Set `SUPPORT_EMAIL` to a public operator support address. Workspace support and private feedback already work; direct email is unavailable unless configured. No automated support-email delivery or response-time promise was added.
- Complete the operator's legal identity, privacy contact, applicable retention commitments, commercial terms, cancellation/refund policy, and any jurisdiction-specific notices before a public paid launch. There were no existing public legal pages. `/privacy` and `/terms` describe the implemented service and explicitly identify missing operator provisions; they are not a legally reviewed policy for an unidentified operator.

## Truthful product scope

Vercel is the connected hosting provider. Supported deployments are static HTML/exported web builds, separate from stored source archives. Isolated npm build verification needs the configured Sandbox integration. External server apps, databases and domains are not automatically recreated or preserved. AI needs a configured provider and quota; editable saved-notes briefs work without AI. Parking does not stop hosting or billing. **Publish as a Paid AI Tool** is explicitly Coming Soon; no monetization workflow is claimed.

## Search indexing

The homepage, support, privacy and terms have canonical URLs and public metadata. The branded `/opengraph-image` is generated as a 1200×630 PNG using a local font. The homepage includes Organization, WebSite and factual SoftwareApplication JSON-LD without ratings, reviews or fabricated business identity.

`/sitemap.xml` lists these product pages and explicitly published portfolio slugs, with their actual stored update times. Private drafts, dashboard/account routes, individual project share links and bearer-token review/package links are never enumerated. Unpublishing a portfolio removes it from the next sitemap response. Marketing entries remain available if the database is unavailable.

Private dashboard/account pages have noindex metadata and HTTP `X-Robots-Tag`; token-bearing project/review/package pages and APIs receive noindex headers. Robots excludes those private/capability routes while allowing page assets and account-page crawling so their noindex metadata can be read. Search directives do not replace existing authentication or download permissions.

## Verification

Run `npm run build`, `npm test`, and `npm run test:e2e` against a production build with isolated `CHAPTER_DATA_DIR`. The landing tests check JavaScript-disabled HTML, anonymous and authenticated behavior, private data exclusion, protected routes, auth/checkout/support destinations, plan limits, social image dimensions, sitemap/robots, keyboard navigation, FAQs, footer routes, and widths 320/390/768/1440. Existing phase tests continue to exercise project workflows through `/dashboard`.

To regenerate the product screenshot, run `node scripts/capture-landing-preview.mjs` against an anonymous `/demo` page. The script checks that there is no authenticated user before saving the asset. Do not use a real account's dashboard as a marketing screenshot.
