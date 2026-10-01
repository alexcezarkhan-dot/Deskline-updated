-- Trading Journal: run once in Supabase → SQL Editor
create table if not exists public.trades (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  trade_date date not null,
  instrument text not null,
  side text check (side in ('Long','Short')),
  session text,
  entry numeric, exit_price numeric, stop_loss numeric, size numeric,
  risk numeric not null,
  pnl numeric not null,
  strategy text, tag text, notes text,
  pre_trade_emotion text, post_trade_emotion text,
  created_at timestamptz default now()
);

create index if not exists trades_user_date on public.trades (user_id, trade_date desc);

alter table public.trades enable row level security;

drop policy if exists "Users manage own trades" on public.trades;
create policy "Users manage own trades"
  on public.trades for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
