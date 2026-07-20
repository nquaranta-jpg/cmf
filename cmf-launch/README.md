# CMF Launch marketing site

Static marketing site for CMF Launch, the agent platform run by Crown
Merchant Financial LLC. Built with Astro and Tailwind CSS, static output,
no backend.

## IMPORTANT: copy is not final

The two source-of-truth copy documents were not present in the repository
when this site was scaffolded:

- `cmf-launch-landing-page.md`
- `cmf-launch-free-training-page.md`

Every user-visible string currently renders a bracketed
`[PASTE VERBATIM: ...]` slot. **The site must not go live until every slot
in `src/copy/` is replaced with the exact text from those documents** -
especially the TCPA consent checkbox label and the footer compliance
paragraph, which are legally significant. See "How to swap copy" below.

## Local dev

```bash
cd cmf-launch
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
npm run preview    # serve the built site locally
```

## Environment variables

Copy `.env.example` to `.env`. All variables are `PUBLIC_` (inlined at
build time), so redeploy after changing them.

| Variable | Purpose | When unset |
| --- | --- | --- |
| `PUBLIC_LOGIN_URL` | "Log In" button target (GoHighLevel portal) | falls back to `#` |
| `PUBLIC_SIGNUP_URL` | "Create Your Free Account" button target (GoHighLevel portal) | falls back to `#` |
| `PUBLIC_FORM_WEBHOOK_URL` | GoHighLevel inbound webhook that receives the opt-in form as JSON | form shows an inline error on submit |
| `PUBLIC_GTM_ID` | Google Tag Manager container id | GTM snippet renders nothing |
| `PUBLIC_META_PIXEL_ID` | Meta Pixel id | pixel snippet renders nothing |

The opt-in form POSTs JSON:
`{ firstName, lastName, email, mobile, consent, source: "free-training-page" }`.

## Brand tokens

All four brand tokens live in one place:
`src/styles/global.css`, at the top of the file:

```css
:root {
  --brand-bg: #0b0e14;       /* near-black background */
  --brand-accent: #c9a227;   /* deep gold */
  --brand-accent-2: #4a6fa5; /* steel blue */
  --brand-text: #f4f4f2;     /* off-white text */
}
```

Change these values and the whole site follows; every color on the site
keys off them (via Tailwind's `brand-*` utilities and the `.band` /
`.band-alt` section backgrounds).

## How to swap copy

All copy lives in `src/copy/`:

- `shared.ts` - nav labels, footer compliance paragraph
- `landing.ts` - every section of the home page, in order
- `free-training.ts` - opt-in page, form labels, TCPA consent text,
  thank-you page

Paste the text from the copy documents verbatim into the matching fields.
Rules that must hold: no rewriting or "improving" the copy, no invented
statistics or testimonials, no carrier names on the free-training page,
no em dashes anywhere in rendered text, and the compliance paragraph and
consent text exactly as written.

Also fill in the page `meta` titles/descriptions (written from the page
copy) and set the production URL in `src/copy/shared.ts` (`site.url`) so
Open Graph tags resolve correctly.

## Deploy

One command with the Vercel CLI, from this directory:

```bash
npx vercel --prod
```

Or connect the repo to Vercel/Netlify and set the project root directory
to `cmf-launch/` - Astro is auto-detected, zero further config. Set the
environment variables in the project dashboard.

Note: the repository root is a separate, older static site with its own
`netlify.toml`. This site is self-contained inside `cmf-launch/`.
