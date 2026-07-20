/**
 * FREE TRAINING OPT-IN PAGE COPY (routes: /free-training and /thank-you)
 *
 * Source of truth: cmf-launch-free-training-page.md (in this directory's
 * project root). All strings below are verbatim from that document.
 * Copy rules: do not rewrite or "improve"; no carrier names on this page;
 * no em dashes; no invented statistics or income claims.
 */

export const meta = {
  title: "Free IUL Training | CMF Launch",
  description:
    "The 45-minute training built to get a new agent to their first submitted IUL application in 7 days. Instant access. 45 minutes. 100% free.",
};

export const hero = {
  eyebrow: "Free IUL Training",
  h1: "The 45-minute training built to get a new agent to their first submitted IUL application in 7 days.",
  body: "A working producer walking you through how to open a call with a working parent without getting hung up on, qualify income and health in five minutes, explain an IUL in plain language without overpromising, and close the application on the phone. The same playbook every new CMF agent runs on day one.",
  accessLine: "Instant access. 45 minutes. 100% free.",
  hostedBy: "Hosted by Nicholas Quaranta",
  hostCredentials:
    "Founder, Crown Merchant Financial. Navy veteran. Working producer.",
};

export const optIn = {
  heading: "Save your seat. Watch on your time.",
  subhead: "Drop your info below and the link goes straight to your inbox.",
  form: {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    mobile: "Mobile",
    // TODO: legal review required before launch (build note 1). The text
    // below is the drafted consent language from the copy doc, verbatim.
    // TODO: link "Terms" to the Terms page when one exists; the visible
    // text must stay exactly as written.
    consentLabel:
      "I agree to Crown Merchant Financial LLC's Terms and consent to receive automated marketing texts, emails, and calls from Crown Merchant Financial at the number provided, including via autodialer and prerecorded messages. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out. Not affiliated with or endorsed by any government agency.",
    submitLabel: "Register for the Free Training",
    postSubmitNote:
      "You get instant access. Watch on your schedule, as many times as you want.",
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

export const whatYoullLearn = {
  eyebrow: "What You'll Learn",
  heading: "The 6 things every IUL producer has to get right.",
  intro:
    "Fix even two of these and your next month gets bigger. Fix all six and you are writing the cases most agents never learn how to open.",
  modules: [
    {
      label: "Prospecting",
      title: "Where real IUL prospects come from.",
      body: "Which audiences actually fund policies, why a working parent with income beats a curious tire-kicker every time, and how to build a pipeline of people who can say yes.",
    },
    {
      label: "The Opening",
      title: "The first 30 seconds that keep a working parent on the phone.",
      body: "The exact opening line, word for word. Why leading with protection beats leading with cash value, and how to deliver it so it sounds like a person instead of a pitch.",
    },
    {
      label: "Qualifying",
      title: "Income, health, and funding in five minutes.",
      body: "The questions that tell you whether the case can actually be funded, which carrier fits, and whether you are holding a real application or an afternoon of wasted illustrations.",
    },
    {
      label: "The Presentation",
      title: "Protection first. Cash value second. No jargon.",
      body: "How to explain an IUL in plain language, walk an illustration honestly, and never sell it as an investment. Simple, compliant, and it closes better than hype ever will.",
    },
    {
      label: "Objections",
      title: "The three objections on every IUL call.",
      body: '"I can do better in the market." "This sounds too good to be true." "I need to run it by my spouse." What to say to each one, with words that respect the client and keep the case alive.',
    },
    {
      label: "The Close",
      title: "Closing the application and setting up funding.",
      body: "How to walk the client through the app and the draft, set expectations for underwriting and delivery, and structure the premium so the policy stays funded and on the books.",
    },
  ],
};

export const whoThisIsFor = {
  eyebrow: "Who This Is For",
  heading: "Three kinds of agents get the most out of this.",
  cards: [
    {
      title: "New agent",
      lead: "You just got your license.",
      body: "No book, no script, no idea where to start. This training is the on-ramp: what to say, who to call, and what a real first month looks like.",
    },
    {
      title: "Final expense producer",
      lead: "You write FE and want bigger cases.",
      body: "You can close seniors on the phone all day, but every case is small and every month starts at zero. IUL is the upgrade path: bigger premiums, younger clients, and a book that compounds. This training is the bridge.",
    },
    {
      title: "Agency builder",
      lead: "You run a downline of writers.",
      body: "You want one 45-minute training you can hand every new agent on day one so your whole team opens, qualifies, and presents the same way. This is that training.",
    },
  ],
};

export const trainer = {
  eyebrow: "Your Trainer",
  heading: "Nicholas Quaranta. Producer first. Founder second.",
  paragraphs: [
    "Nick spent six years as a Navy corpsman, worked as an analyst at Guggenheim Securities, and then built Crown Merchant Financial, an independent agency appointed with six carriers and writing IUL, term, whole life, and final expense. He is a working producer, and this training is the exact 45 minutes he sits every new CMF agent down for on day one.",
    "This is not theory from someone who has not dialed in a decade. This is the current playbook, from the phone, this year.",
  ],
};

export const closer = {
  heading: "Spend 45 minutes. Watch what changes.",
  body: "The training is free and yours to watch on your schedule. Save your seat below and the link is in your inbox in two minutes.",
  ctaLabel: "Register for the Free Training",
  note: "No credit card. No call required.",
};

export const thankYou = {
  meta: {
    title: "Your training link is on the way | CMF Launch",
    description:
      "Your training link is on the way. The training runs on CMF Launch: exclusive leads at cost, the CRM, and the full Crown Sales Academy library.",
  },
  h1: "Your training link is on the way. While you wait, look around.",
  paragraphs: [
    "The training runs on CMF Launch, the platform behind it: exclusive leads at cost, the CRM, and the full Crown Sales Academy library. The free account takes 60 seconds and shows you everything, including live lead inventory in your state.",
  ],
  ctaLabel: "Create Your Free CMF Launch Account",
};
