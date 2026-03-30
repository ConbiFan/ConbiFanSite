create extension if not exists pgcrypto;

-- Owner email for delete permission is set below. Update it here if you ever change accounts.

create table if not exists public.engagement_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null,
  page_path text not null,
  item_label text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists engagement_comments_thread_created_at_idx
  on public.engagement_comments (thread_id, created_at desc);

create table if not exists public.engagement_likes (
  thread_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (thread_id, user_id)
);

create table if not exists public.engagement_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid references public.engagement_comments (id) on delete set null,
  thread_id text not null,
  page_path text not null,
  item_label text not null,
  comment_author text not null,
  comment_body text not null,
  reporter_user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 280),
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create index if not exists engagement_reports_created_at_idx
  on public.engagement_reports (created_at desc);

create index if not exists engagement_reports_resolved_at_idx
  on public.engagement_reports (resolved_at, created_at desc);

alter table public.engagement_comments enable row level security;
alter table public.engagement_likes enable row level security;
alter table public.engagement_reports enable row level security;

drop policy if exists "engagement comments are readable by signed-in visitors" on public.engagement_comments;
create policy "engagement comments are readable by signed-in visitors"
  on public.engagement_comments
  for select
  to authenticated
  using (true);

drop policy if exists "engagement comments are insertable by their author" on public.engagement_comments;
create policy "engagement comments are insertable by their author"
  on public.engagement_comments
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "engagement comments are deletable by owner email" on public.engagement_comments;
create policy "engagement comments are deletable by owner email"
  on public.engagement_comments
  for delete
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );

drop policy if exists "engagement likes are readable by signed-in visitors" on public.engagement_likes;
create policy "engagement likes are readable by signed-in visitors"
  on public.engagement_likes
  for select
  to authenticated
  using (true);

drop policy if exists "engagement likes are insertable by their owner" on public.engagement_likes;
create policy "engagement likes are insertable by their owner"
  on public.engagement_likes
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "engagement likes are removable by their owner" on public.engagement_likes;
create policy "engagement likes are removable by their owner"
  on public.engagement_likes
  for delete
  to authenticated
  using (
    auth.uid() is not null
    and auth.uid() = user_id
  );

drop policy if exists "engagement reports are insertable by signed-in visitors" on public.engagement_reports;
create policy "engagement reports are insertable by signed-in visitors"
  on public.engagement_reports
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = reporter_user_id
  );

drop policy if exists "engagement reports are readable by owner email" on public.engagement_reports;
create policy "engagement reports are readable by owner email"
  on public.engagement_reports
  for select
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );

drop policy if exists "engagement reports are updatable by owner email" on public.engagement_reports;
create policy "engagement reports are updatable by owner email"
  on public.engagement_reports
  for update
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  )
  with check (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );
