# crownmerchantfinancial.com: notes for Claude

## Publish all new content to Insights & News (standing rule from Nick, Nov 2026)

Any time content is created by Nick or for Nick that belongs on the CMF site
(a guide, an explainer, a tool, a workshop, a case study, a press item, an
announcement, a report or white paper), publish it on the site the way
apollo.com publishes its Insights & News:

1. If it needs a page, build it in the site's design system (shared masthead and
   footer, `css/society.css` page system or `css/strategy.css`, Cormorant
   Garamond headings, Inter text, navy and blue palette).
2. Add a row to the Google Sheet "CMF Website: Insights & News", tab
   "Insights" (https://docs.google.com/spreadsheets/d/1oQ734CY_Grh1pPM08VTEqC0q6J6QCt5wOnBni60PiM0/edit),
   using the Google Sheets connector: Show (tick), Date (YYYY-MM-DD), Type
   (Insight | Guide | Tool | Workshop | News), Category, Title, Summary
   (one or two plain-English sentences), Link (a site path like /products/iul
   or a full https link), Featured (tick at most one; if several are ticked,
   the newest wins).
3. The site reads the sheet through `netlify/functions/insights.mjs` and shows
   the row on `/insights` (with type filters) and in the homepage Insights &
   News section (latest three items that are not guides, since guides have
   their own homepage section) within about 5 minutes. Also add the same item
   to `data/insights.json`, the fallback snapshot used if the sheet can't be read.

Do NOT add posts from Nick's personal blog (nicholasquaranta.com). The blog stays
separate from the CMF site.

## Shipping

- Work on a branch and open a pull request; merging to `main` deploys to
  production on Netlify. Nick approves each merge.
- Never state facts about licensing, carriers, compensation or programs that
  Nick has not confirmed. Nick is individually licensed in all 50 states.
- No em dashes in outreach copy.
