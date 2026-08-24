-- DeskTerminal user profiles schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text,
  email text,
  photo_url text,
  country text,
  role text default 'member',
  watchlist jsonb default '[]'::jsonb,
  favorites jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  last_login timestamptz default now()
);

-- Row Level Security: this is what makes profiles strictly private per user.
-- With RLS on and only these policies defined, a user can ONLY ever see or
-- change their OWN row — not other users' data, even via the API directly.
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row the first time someone signs up,
-- pre-filled from whatever Google/Facebook gave us.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, photo_url, last_login)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    now()
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- Community-submitted news, with admin approval before anything goes live
-- ---------------------------------------------------------------------
create table public.submitted_news (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  url text not null,
  source_name text,
  category text default 'Educational News',
  image_url text,
  submitted_by uuid references auth.users on delete set null,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now(),
  reviewed_at timestamptz
);

alter table public.submitted_news enable row level security;

-- Anyone signed in can submit a story.
create policy "Signed-in users can submit news"
  on public.submitted_news for insert
  with check (auth.uid() = submitted_by);

-- Everyone (including logged-out visitors) can see approved stories —
-- this is what makes them show up in the real news feed.
create policy "Anyone can view approved news"
  on public.submitted_news for select
  using (status = 'approved');

-- A submitter can see their own submission regardless of its status, so
-- they know whether it's pending, approved, or rejected.
create policy "Users can view their own submissions"
  on public.submitted_news for select
  using (auth.uid() = submitted_by);

-- Only users whose profile role is 'admin' can see pending/rejected items
-- or change a submission's status — this is the actual approval gate.
create policy "Admins can view all submissions"
  on public.submitted_news for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "Admins can update submission status"
  on public.submitted_news for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------
-- Storage bucket for images attached to submitted news stories.
-- Note: this INSERT needs Storage enabled on your Supabase project —
-- it's on by default, no separate setup needed beyond running this SQL.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('news-submissions', 'news-submissions', true)
on conflict (id) do nothing;

create policy "Signed-in users can upload submission images"
  on storage.objects for insert
  with check (bucket_id = 'news-submissions' and auth.role() = 'authenticated');

create policy "Anyone can view submission images"
  on storage.objects for select
  using (bucket_id = 'news-submissions');

-- ---------------------------------------------------------------------
-- Shared, server-cached news — fetched once by a scheduled job (not by
-- every visitor's browser), stored here, and read by everyone. This is
-- what makes "fetch once, everyone sees the same cached result" real:
-- link is UNIQUE, so re-inserting the same real story is a genuine no-op
-- at the database level, not just something the app code has to remember.
-- ---------------------------------------------------------------------
create table public.cached_news (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  link text not null unique,
  source text,
  image text,
  description text,
  pub_date timestamptz,
  fetched_at timestamptz default now(),
  impact text check (impact in ('high', 'medium', 'low')),
  currency text,
  effect text check (effect in ('strengthen', 'weaken'))
);

alter table public.cached_news enable row level security;

-- Everyone — including logged-out visitors — can read the cache. This is
-- the whole point: one fetch serves every visitor.
create policy "Anyone can view cached news"
  on public.cached_news for select
  using (true);

-- Deliberately NO insert/update/delete policy for the public anon key.
-- Only the service role key (used exclusively by the scheduled
-- cache-news function, never exposed to browsers) can write here —
-- Supabase's service role bypasses RLS entirely for legitimate
-- server-side jobs like this one.

