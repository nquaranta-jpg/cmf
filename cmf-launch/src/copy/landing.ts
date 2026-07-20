/**
 * LANDING PAGE COPY (route: /)
 *
 * Source: cmf-launch-landing-page.md (in this directory's project root).
 * NOTE: that document is a DRAFT written by Claude at the owner's request,
 * because the original landing page doc was never provided. Owner review
 * required before launch, especially the Crown Match section (the program
 * is described as producer-mentor matching; no definition existed in the
 * provided materials) and the footer compliance paragraph (legal review).
 */

export const meta = {
  title: "CMF Launch | The Agent Platform from Crown Merchant Financial",
  description:
    "Exclusive leads at cost, a CRM that runs your day, and the full Crown Sales Academy library. Purpose built for final expense, term, and IUL telesales. The free account takes 60 seconds.",
};

export const hero = {
  h1: "Built to turn licensed agents into producers.",
  subhead:
    "CMF Launch is the agent platform from Crown Merchant Financial: exclusive leads at cost, a CRM that runs your day, and the full Crown Sales Academy library. Purpose built for final expense, term, and IUL telesales. The free account takes 60 seconds and shows you everything.",
  primaryCta: "Create Your Free Account",
  secondaryCta: "Log In",
};

export const howItWorks = {
  heading: "Four steps from login to submitted business.",
  intro: "",
  steps: [
    {
      title: "Create your free account",
      body: "60 seconds, no credit card. Look around the whole platform, including live lead inventory in your state.",
    },
    {
      title: "Train like it is day one",
      body: "Start with the same training every new CMF agent gets: openings, qualifying, presentations, and closes, all on the phone.",
    },
    {
      title: "Order leads at cost",
      body: "Exclusive leads, priced at what they cost to generate. No markup, no resells, no chasing a vendor for credit.",
    },
    {
      title: "Dial, write, repeat",
      body: "Work your pipeline in CMF Desk, submit business, and build a book that compounds. The target from day one: your first application submitted in your first week.",
    },
  ],
};

export const whoThisIsFor = {
  heading: "Be honest about which list you are on.",
  forYou: {
    title: "This is for you if",
    items: [
      "You want to sell by phone, from anywhere, on a schedule you control.",
      "You are new, or newly serious, and want one system instead of ten opinions.",
      "You want your lead cost on the table and your training in one place.",
    ],
  },
  notForYou: {
    title: "This is not for you if",
    items: [
      "You want leads for free. At cost is as low as it goes.",
      "You are not licensed and not planning to get licensed.",
      "You want a manager to make you dial. The system works when you work.",
    ],
  },
};

export const crownMatch = {
  // TODO: owner review. Crown Match is described as producer-mentor matching
  // because no definition of the program existed in the provided materials.
  heading: "Nobody builds alone here.",
  paragraphs: [
    "Every agent who joins CMF Launch gets matched with a working producer who has already built what you are building. Not a recruiter. Not an upline you never hear from. A producer who dials, closes, and picks up when you call.",
    "Your first week, your first case, your first bad month. Crown Match means someone who has been through all three is in your corner from day one.",
  ],
  ctaLabel: "Create Your Free Account",
};

export const faq = {
  heading: "Questions agents actually ask.",
  items: [
    {
      q: "Is the free account actually free?",
      a: "Yes. It takes 60 seconds, needs no credit card, and shows you the whole platform, including live lead inventory in your state. You pay only when you order leads.",
    },
    {
      q: "Do I need experience?",
      a: "No. The training assumes a license and a work ethic, nothing else. If you can follow a playbook and make calls, the system is built for you.",
    },
    {
      q: "What can I write?",
      a: "Final expense, term, whole life, and IUL, by phone. Crown Merchant Financial is an independent agency appointed with six carriers.",
    },
    {
      q: "Are the leads really exclusive and at cost?",
      a: "Yes. Leads are generated for CMF agents, sold once, and priced at cost. The live inventory in your account shows exactly what is available in your state before you spend a dollar.",
    },
    {
      q: "Do I have to commit to anything to look?",
      a: "No. The free account comes with no commitment. Look around, watch the training, check the lead inventory, and decide with everything in front of you.",
    },
  ],
};

export const finalCta = {
  heading: "See the whole platform in the next 60 seconds.",
  ctaLabel: "Create Your Free Account",
};
