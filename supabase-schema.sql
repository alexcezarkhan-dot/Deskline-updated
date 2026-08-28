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
  reviewed_at timestamptz,
  impact text check (impact in ('high', 'medium', 'low')),
  currency text,
  effect text check (effect in ('strengthen', 'weaken'))
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


-- ==========================================================================
-- DeskFeed — social feed schema (PLANNED, not yet built into the live site)
-- ==========================================================================
-- Shares the same Supabase project as the main site, so one account works
-- on both deskterminal.com and feed.deskterminal.com automatically — no
-- separate signup needed. Every table below follows the same real
-- discipline as the rest of this file: RLS enforced at the database level,
-- not just hidden in the UI.

-- ---------------------------------------------------------------------
-- Posts — the core content table
-- ---------------------------------------------------------------------
create table public.feed_posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  linked_symbol text, -- optional, e.g. 'XAUUSD' — lets a post tag a specific instrument
  likes_count int default 0,
  comments_count int default 0,
  created_at timestamptz default now()
);

alter table public.feed_posts enable row level security;

create policy "Anyone can view posts"
  on public.feed_posts for select
  using (true);

create policy "Signed-in users can create their own posts"
  on public.feed_posts for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own posts"
  on public.feed_posts for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Likes — a real join table, not just a counter, so double-likes are
-- genuinely impossible at the database level, not just prevented in JS.
-- ---------------------------------------------------------------------
create table public.feed_likes (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.feed_posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  created_at timestamptz default now(),
  unique(post_id, user_id) -- the real constraint that makes double-liking impossible
);

alter table public.feed_likes enable row level security;

create policy "Anyone can view likes"
  on public.feed_likes for select
  using (true);

create policy "Signed-in users can like posts as themselves"
  on public.feed_likes for insert
  with check (auth.uid() = user_id);

create policy "Users can unlike their own likes"
  on public.feed_likes for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------
create table public.feed_comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.feed_posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

alter table public.feed_comments enable row level security;

create policy "Anyone can view comments"
  on public.feed_comments for select
  using (true);

create policy "Signed-in users can comment as themselves"
  on public.feed_comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own comments"
  on public.feed_comments for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Follows — a user can only control their OWN follow relationships,
-- never force someone else to follow or unfollow on their behalf.
-- ---------------------------------------------------------------------
create table public.feed_follows (
  id uuid default gen_random_uuid() primary key,
  follower_id uuid references auth.users on delete cascade not null,
  following_id uuid references auth.users on delete cascade not null,
  created_at timestamptz default now(),
  unique(follower_id, following_id),
  check (follower_id != following_id) -- can't follow yourself
);

alter table public.feed_follows enable row level security;

create policy "Anyone can view follow relationships"
  on public.feed_follows for select
  using (true);

create policy "Users can follow others as themselves"
  on public.feed_follows for insert
  with check (auth.uid() = follower_id);

create policy "Users can unfollow as themselves"
  on public.feed_follows for delete
  using (auth.uid() = follower_id);

-- ---------------------------------------------------------------------
-- Bookmarks — deliberately PRIVATE, unlike likes/follows. What someone
-- has bookmarked isn't public information the way a like is.
-- ---------------------------------------------------------------------
create table public.feed_bookmarks (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.feed_posts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  created_at timestamptz default now(),
  unique(post_id, user_id)
);

alter table public.feed_bookmarks enable row level security;

create policy "Users can view only their own bookmarks"
  on public.feed_bookmarks for select
  using (auth.uid() = user_id);

create policy "Users can bookmark as themselves"
  on public.feed_bookmarks for insert
  with check (auth.uid() = user_id);

create policy "Users can remove their own bookmarks"
  on public.feed_bookmarks for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Notifications — also private. Only the recipient can see their own.
-- ---------------------------------------------------------------------
create table public.feed_notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null, -- who receives it
  actor_id uuid references auth.users on delete cascade not null, -- who triggered it
  type text check (type in ('like', 'comment', 'follow')) not null,
  post_id uuid references public.feed_posts on delete cascade, -- null for follow notifications
  read boolean default false,
  created_at timestamptz default now()
);

alter table public.feed_notifications enable row level security;

create policy "Users can view only their own notifications"
  on public.feed_notifications for select
  using (auth.uid() = user_id);

create policy "Users can mark their own notifications as read"
  on public.feed_notifications for update
  using (auth.uid() = user_id);

-- Note: inserting a notification happens as part of the like/comment/follow
-- action itself (via a real database function or the app's own backend
-- logic), not directly by the acting user — this is intentionally left
-- for the real build phase, since it needs care to prevent someone
-- spoofing notifications for actions they didn't actually take.
