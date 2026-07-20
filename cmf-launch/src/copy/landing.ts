/**
 * LANDING PAGE COPY (route: /)
 *
 * !! Every [PASTE VERBATIM: ...] string is a slot for the exact text from
 * cmf-launch-landing-page.md. See src/copy/shared.ts for the copy rules. !!
 *
 * The section list below follows the build prompt (hero, how it works,
 * who this is for, Crown Match, FAQ). TODO: reconcile this list with the
 * actual section order in cmf-launch-landing-page.md when the doc is added;
 * add or remove section objects so the page matches the doc section for
 * section, in order.
 */

export const meta = {
  // TODO: write title/description from the page copy once the doc is present.
  title: "CMF Launch | Crown Merchant Financial",
  description:
    "[PASTE: meta description written from cmf-launch-landing-page.md copy]",
};

export const hero = {
  h1: "[PASTE VERBATIM: cmf-launch-landing-page.md - hero headline]",
  subhead: "[PASTE VERBATIM: cmf-launch-landing-page.md - hero subhead]",
  // Button labels per the build prompt; confirm against the doc.
  primaryCta: "Create Your Free Account",
  secondaryCta: "Log In",
};

export const howItWorks = {
  heading: "[PASTE VERBATIM: cmf-launch-landing-page.md - How It Works heading]",
  intro: "", // leave empty to render nothing; paste intro copy if the doc has one
  steps: [
    {
      title: "[PASTE VERBATIM: step 1 title]",
      body: "[PASTE VERBATIM: step 1 body]",
    },
    {
      title: "[PASTE VERBATIM: step 2 title]",
      body: "[PASTE VERBATIM: step 2 body]",
    },
    {
      title: "[PASTE VERBATIM: step 3 title]",
      body: "[PASTE VERBATIM: step 3 body]",
    },
    {
      title: "[PASTE VERBATIM: step 4 title]",
      body: "[PASTE VERBATIM: step 4 body]",
    },
  ],
};

export const whoThisIsFor = {
  heading:
    "[PASTE VERBATIM: cmf-launch-landing-page.md - Who This Is For heading]",
  forYou: {
    title: "[PASTE VERBATIM: 'for you' list title]",
    items: [
      "[PASTE VERBATIM: for-you item 1]",
      "[PASTE VERBATIM: for-you item 2]",
      "[PASTE VERBATIM: for-you item 3]",
    ],
  },
  notForYou: {
    title: "[PASTE VERBATIM: 'not for you' list title]",
    items: [
      "[PASTE VERBATIM: not-for-you item 1]",
      "[PASTE VERBATIM: not-for-you item 2]",
      "[PASTE VERBATIM: not-for-you item 3]",
    ],
  },
};

export const crownMatch = {
  heading: "[PASTE VERBATIM: cmf-launch-landing-page.md - Crown Match heading]",
  // One entry per paragraph, in order.
  paragraphs: ["[PASTE VERBATIM: Crown Match body paragraphs]"],
  ctaLabel: "Create Your Free Account",
};

export const faq = {
  heading: "[PASTE VERBATIM: cmf-launch-landing-page.md - FAQ heading]",
  items: [
    {
      q: "[PASTE VERBATIM: FAQ question 1]",
      a: "[PASTE VERBATIM: FAQ answer 1]",
    },
    {
      q: "[PASTE VERBATIM: FAQ question 2]",
      a: "[PASTE VERBATIM: FAQ answer 2]",
    },
    {
      q: "[PASTE VERBATIM: FAQ question 3]",
      a: "[PASTE VERBATIM: FAQ answer 3]",
    },
  ],
};

export const finalCta = {
  heading: "[PASTE VERBATIM: cmf-launch-landing-page.md - closing CTA heading]",
  ctaLabel: "Create Your Free Account",
};
