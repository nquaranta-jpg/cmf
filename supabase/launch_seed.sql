-- ============================================================
-- CMF Launch — demo seed data (safe, obviously fake)
-- Run AFTER launch_schema.sql.
-- Creates one managed-ads demo client you can sign in with:
--   email:    demo@cmflaunch.com
--   password: LaunchClient2026!
-- ============================================================

-- Demo client
insert into public.launch_clients (id, email, password_hash, full_name, agency_name, plan, billing_status, monthly_ad_budget)
values (
  '11111111-1111-4111-8111-111111111111',
  'demo@cmflaunch.com',
  'scrypt$16384$97568cb728edd59d9872e1ea366dbefe$342641299f1e0f8c683688f256515ddf9aa20a7ed88f73e6d5b0d355ba19ec25d78d7480bd194b6df52505f7926bea3e422af7f096004b6b2dc1621e183706ae',
  'Jordan Demo',
  'Demo Insurance Group',
  'ads_managed',
  'active',
  3000.00
)
on conflict (email) do nothing;

-- ~30 leads over the past 45 days, mixed statuses
insert into public.launch_leads (client_id, name, phone, email, state, lead_type, source, status, notes, received_at)
select
  '11111111-1111-4111-8111-111111111111',
  (array['Mary Sample','James Testman','Patricia Demoson','Robert Fakely','Linda Placeholder','Michael Mockford','Barbara Example','William Dummy','Elizabeth Specimen','David Sampleton','Susan Mockwell','Richard Testerly','Jessica Demofield','Thomas Fauxman','Sarah Exampleton','Charles Mocksmith','Karen Sampleworth','Christopher Testwood','Nancy Demolane','Daniel Fakerton','Lisa Specimenson','Matthew Mockler','Betty Samplefield','Anthony Testbrook','Margaret Demoford','Mark Fauxwell','Sandra Exemplar','Donald Mockton','Ashley Samplewood','Steven Testfield'])[i],
  '(555) 01' || lpad(i::text, 2, '0') || '-' || lpad((1000 + i * 37)::text, 4, '0'),
  'demo.lead' || i || '@example.com',
  (array['IL','TX','FL','OH','GA','NC','AZ','MI','PA','TN'])[1 + (i % 10)],
  (array['final_expense','final_expense','term_life','iul','veteran','mortgage_protection'])[1 + (i % 6)],
  'meta',
  -- newest leads (high i = most recent received_at) are still 'new';
  -- the oldest have been worked to sold/dead
  case
    when i > 24 then 'new'
    when i > 16 then 'contacted'
    when i > 11 then 'appointment'
    when i > 5  then 'sold'
    else 'dead'
  end,
  case when i <= 5 then 'No answer after 5 attempts.' when i > 5 and i <= 11 then 'Closed — policy submitted.' else '' end,
  now() - ((45 - i * 1.5) || ' days')::interval
from generate_series(1, 30) as i;

-- Daily ad spend for the past 90 days (~$95/day avg, weekends lighter)
insert into public.launch_spend_entries (client_id, entry_date, spend, leads_count)
select
  '11111111-1111-4111-8111-111111111111',
  d::date,
  round((85 + 30 * sin(extract(doy from d) / 5.0)
        + case when extract(isodow from d) >= 6 then -25 else 0 end
        + (extract(day from d) * 7 % 23))::numeric, 2),
  greatest(0, round(3 + 2 * sin(extract(doy from d) / 4.0) + (extract(day from d)::int % 3) - case when extract(isodow from d) >= 6 then 1 else 0 end))::int
from generate_series(current_date - interval '89 days', current_date, interval '1 day') as d
on conflict (client_id, entry_date) do nothing;

-- A few example form submissions so the export has data
insert into public.launch_submissions (form_type, name, email, phone, payload) values
  ('iul_optin', 'Alex Agentsmith', 'alex.demo@example.com', '', '{"source":"seed"}'),
  ('ads_application', 'Casey Producerton', 'casey.demo@example.com', '(555) 0142-8890', '{"monthly_budget":"2500","states":"IL, WI","source":"seed"}'),
  ('match_application', 'Riley Closerfield', 'riley.demo@example.com', '(555) 0177-3321', '{"years_licensed":"4","current_production":"placeholder","source":"seed"}');
