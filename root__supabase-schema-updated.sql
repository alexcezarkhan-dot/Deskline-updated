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
