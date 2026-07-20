/**
 * SHARED COPY - single place to paste site-wide copy.
 *
 * !! COPY SOURCE OF TRUTH !!
 * The verbatim copy lives in two documents that were NOT present in this
 * repository when the site was scaffolded:
 *   - cmf-launch-landing-page.md
 *   - cmf-launch-free-training-page.md
 * Every string below marked with [PASTE VERBATIM: ...] is a slot. Replace it
 * with the exact text from the named document and section. Do not rewrite,
 * shorten, or "improve" the copy, and do not introduce em dashes.
 */

export const site = {
  name: "CMF Launch",
  company: "Crown Merchant Financial LLC",
  // TODO: replace with the real production URL before launch (used for OG tags).
  url: "https://example.com",
};

// Nav labels as specified in the build prompt. Confirm against the copy docs.
export const nav = {
  links: [
    // Anchor links into the landing page; swap to real pages when they exist.
    { label: "Platform", href: "/#platform" },
    { label: "Partners", href: "/#partners" },
    { label: "About", href: "/#about" },
    { label: "Contact", href: "/#contact" },
  ],
  login: "Log In",
  signup: "Create Your Free Account",
};

export const footer = {
  // TODO: drafted compliance language, legal review required before launch
  // (see cmf-launch-landing-page.md build notes).
  compliance:
    "Crown Merchant Financial LLC is an independent, licensed life insurance agency. CMF Launch is a platform for licensed insurance professionals and those pursuing licensure. It is not an offer of employment, and no income is guaranteed or implied; results depend on individual effort, licensing, and market conditions. Life insurance products are subject to carrier underwriting and availability, and product features vary by state. Nothing on this site is financial, tax, or legal advice. Not affiliated with or endorsed by any government agency.",
  copyright: `${new Date().getFullYear()} Crown Merchant Financial LLC`,
};
