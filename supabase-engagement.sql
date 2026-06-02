create extension if not exists pgcrypto;

-- Owner email for delete permission is set below. Update it here if you ever change accounts.

create table if not exists public.engagement_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null,
  page_path text not null,
  item_label text not null,
  user_id uuid not null,
  is_owner boolean not null default false,
  display_name text not null check (char_length(display_name) between 1 and 24),
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.engagement_comments
  drop constraint if exists engagement_comments_user_id_fkey;

alter table public.engagement_comments
  add column if not exists is_owner boolean not null default false;

create index if not exists engagement_comments_thread_created_at_idx
  on public.engagement_comments (thread_id, created_at desc);

create table if not exists public.engagement_likes (
  thread_id text not null,
  user_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (thread_id, user_id)
);

alter table public.engagement_likes
  drop constraint if exists engagement_likes_user_id_fkey;

create table if not exists public.engagement_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid references public.engagement_comments (id) on delete set null,
  thread_id text not null,
  page_path text not null,
  item_label text not null,
  comment_author text not null,
  comment_body text not null,
  reporter_user_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 280),
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

alter table public.engagement_reports
  drop constraint if exists engagement_reports_reporter_user_id_fkey;

create index if not exists engagement_reports_created_at_idx
  on public.engagement_reports (created_at desc);

create index if not exists engagement_reports_resolved_at_idx
  on public.engagement_reports (resolved_at, created_at desc);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 220),
  body text not null check (char_length(body) between 1 and 12000),
  image_url text check (char_length(image_url) <= 2000),
  is_published boolean not null default true,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz
);

alter table public.blog_posts
  add column if not exists image_url text check (char_length(image_url) <= 2000);

create index if not exists blog_posts_publish_order_idx
  on public.blog_posts (is_published, published_at desc, created_at desc);

alter table public.engagement_comments enable row level security;
alter table public.engagement_likes enable row level security;
alter table public.engagement_reports enable row level security;
alter table public.blog_posts enable row level security;

create or replace function public.try_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.cf_visitor_uid()
returns uuid
language sql
stable
as $$
  select public.try_uuid(
    coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-cf-uid',
      nullif(current_setting('request.headers', true), '')::json ->> 'x-client-info',
      ''
    )
  );
$$;

create or replace function public.set_engagement_comment_owner_flag()
returns trigger
language plpgsql
as $$
begin
  new.is_owner := (coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com');
  return new;
end;
$$;

drop trigger if exists engagement_comments_set_owner_flag on public.engagement_comments;
create trigger engagement_comments_set_owner_flag
  before insert on public.engagement_comments
  for each row
  execute function public.set_engagement_comment_owner_flag();

create or replace function public.handle_blog_posts_timestamps()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());

  if new.is_published then
    new.published_at := coalesce(new.published_at, timezone('utc', now()));
  else
    new.published_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists blog_posts_set_timestamps on public.blog_posts;
create trigger blog_posts_set_timestamps
  before insert or update on public.blog_posts
  for each row
  execute function public.handle_blog_posts_timestamps();

drop policy if exists "engagement comments are readable by signed-in visitors" on public.engagement_comments;
create policy "engagement comments are readable by signed-in visitors"
  on public.engagement_comments
  for select
  to anon, authenticated
  using (true);

drop policy if exists "engagement comments are insertable by their author" on public.engagement_comments;
create policy "engagement comments are insertable by their author"
  on public.engagement_comments
  for insert
  to anon, authenticated
  with check (
    public.cf_visitor_uid() is not null
    and user_id = public.cf_visitor_uid()
  );

drop policy if exists "engagement comments are updatable by their author" on public.engagement_comments;
create policy "engagement comments are updatable by their author"
  on public.engagement_comments
  for update
  to anon, authenticated
  using (
    public.cf_visitor_uid() is not null
    and user_id = public.cf_visitor_uid()
  )
  with check (
    public.cf_visitor_uid() is not null
    and user_id = public.cf_visitor_uid()
  );

revoke update on table public.engagement_comments from anon, authenticated;
grant update (display_name) on table public.engagement_comments to anon, authenticated;

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
  to anon, authenticated
  using (true);

drop policy if exists "engagement likes are insertable by their owner" on public.engagement_likes;
create policy "engagement likes are insertable by their owner"
  on public.engagement_likes
  for insert
  to anon, authenticated
  with check (
    public.cf_visitor_uid() is not null
    and user_id = public.cf_visitor_uid()
  );

drop policy if exists "engagement likes are removable by their owner" on public.engagement_likes;
create policy "engagement likes are removable by their owner"
  on public.engagement_likes
  for delete
  to anon, authenticated
  using (
    public.cf_visitor_uid() is not null
    and user_id = public.cf_visitor_uid()
  );

drop policy if exists "engagement reports are insertable by signed-in visitors" on public.engagement_reports;
create policy "engagement reports are insertable by signed-in visitors"
  on public.engagement_reports
  for insert
  to anon, authenticated
  with check (
    public.cf_visitor_uid() is not null
    and reporter_user_id = public.cf_visitor_uid()
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

drop policy if exists "blog posts are publicly readable when published" on public.blog_posts;
create policy "blog posts are publicly readable when published"
  on public.blog_posts
  for select
  to anon, authenticated
  using (
    is_published = true
    or coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );

drop policy if exists "blog posts are insertable by owner email" on public.blog_posts;
create policy "blog posts are insertable by owner email"
  on public.blog_posts
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = author_user_id
    and coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );

drop policy if exists "blog posts are updatable by owner email" on public.blog_posts;
create policy "blog posts are updatable by owner email"
  on public.blog_posts
  for update
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  )
  with check (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );

drop policy if exists "blog posts are deletable by owner email" on public.blog_posts;
create policy "blog posts are deletable by owner email"
  on public.blog_posts
  for delete
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'diver51gence@gmail.com'
  );
