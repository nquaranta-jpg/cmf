/**
 * FREE TRAINING OPT-IN PAGE COPY (routes: /free-training and /thank-you)
 *
 * !! Every [PASTE VERBATIM: ...] string is a slot for the exact text from
 * cmf-launch-free-training-page.md. See src/copy/shared.ts for the copy
 * rules. Copy rule 5: no carrier names anywhere on this page. !!
 */

export const meta = {
  // TODO: write title/description from the page copy once the doc is present.
  title: "Free Training | CMF Launch",
  description:
    "[PASTE: meta description written from cmf-launch-free-training-page.md copy]",
};

export const optIn = {
  h1: "[PASTE VERBATIM: cmf-launch-free-training-page.md - headline]",
  subhead: "[PASTE VERBATIM: cmf-launch-free-training-page.md - subhead]",
  // One entry per supporting paragraph or bullet, in order. Leave empty to
  // render nothing.
  bodyParagraphs: [] as string[],
  bullets: [] as string[],
  form: {
    // Field labels are functional UI text, not marketing copy. Confirm
    // against the doc in case it specifies its own labels.
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    mobile: "Mobile",
    // TODO [PASTE VERBATIM: cmf-launch-free-training-page.md - TCPA consent
    // checkbox text]. Copy rule 7: must render exactly as written. The form
    // must not go live with this placeholder in place.
    consentLabel:
      "[PASTE VERBATIM: cmf-launch-free-training-page.md - TCPA consent text]",
    submitLabel:
      "[PASTE VERBATIM: cmf-launch-free-training-page.md - submit button label]",
    // Functional error strings (not marketing copy).
    errors: {
      required: "This field is required.",
      email: "Enter a valid email address.",
      phone: "Enter a valid US phone number.",
      consent: "Please check the box to continue.",
      submit: "Something went wrong sending your info. Please try again.",
    },
  },
};

export const thankYou = {
  meta: {
    title: "Thank You | CMF Launch",
    description:
      "[PASTE: meta description written from the thank-you copy in cmf-launch-free-training-page.md]",
  },
  h1: "[PASTE VERBATIM: cmf-launch-free-training-page.md - thank-you headline]",
  // One entry per paragraph, in order.
  paragraphs: [
    "[PASTE VERBATIM: cmf-launch-free-training-page.md - thank-you body]",
  ],
};
