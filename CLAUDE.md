# crownmerchantfinancial.com: notes for Claude

## Publish all new content to Insights & News (standing rule from Nick, Nov 2026)

Any time content is created by Nick or for Nick that belongs on the CMF site
(a guide, an explainer, a tool, a workshop, a case study, a press item, an
announcement, a report or white paper), publish it on the site the way
apollo.com publishes its Insights & News:

1. If it needs a page, build it in the site's design system (shared masthead and
   footer, `css/society.css` page system or `css/strategy.css`, Cormorant
   Garamond headings, Inter text, navy and blue palette).
2. Add one entry at the TOP of `items` in `data/insights.json`:
   `type` (Insight | Guide | Tool | Workshop | News), `category`, `title`,
   `summary` (one or two plain-English sentences), `url`, `date` (YYYY-MM-DD).
   Set `featured: true` on at most one item.
3. That single entry shows it on `/insights` (with type filters) and in the
   homepage Insights & News section (latest four). No other wiring is needed.

Do NOT add posts from Nick's personal blog (nicholasquaranta.com). The blog stays
separate from the CMF site.

## Shipping

- Work on a branch and open a pull request; merging to `main` deploys to
  production on Netlify. Nick approves each merge.
- Never state facts about licensing, carriers, compensation or programs that
  Nick has not confirmed. Nick is individually licensed in all 50 states.
- No em dashes in outreach copy.
