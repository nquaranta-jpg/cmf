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
  // TODO [PASTE VERBATIM: cmf-launch-landing-page.md - footer compliance paragraph].
  // Copy rule 7: this paragraph must render exactly as written in the doc.
  compliance:
    "[PASTE VERBATIM: cmf-launch-landing-page.md - compliance paragraph]",
  copyright: `${new Date().getFullYear()} Crown Merchant Financial LLC`,
};
