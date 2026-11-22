create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key,
  title text not null,
  caption text not null default '',
  format text not null,
  platform text not null check (platform in ('instagram', 'tiktok')),
  scheduled_at timestamptz,
  media jsonb not null default '[]'::jsonb,
  status text not null default 'scheduled',
  retry_count integer not null default 0,
  retry_at timestamptz,
  provider_response jsonb,
  error text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  failed_at timestamptz,
  privacy_level text
);

create index if not exists posts_due_idx
  on public.posts (scheduled_at, created_at)
  where status = 'scheduled';

create index if not exists posts_retry_idx
  on public.posts (retry_at, created_at)
  where status = 'failed';

alter table public.posts enable row level security;
revoke all on public.posts from anon, authenticated;

create or replace function public.claim_due_posts(p_now timestamptz, p_limit integer default 10)
returns setof public.posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.posts
    where (status = 'scheduled' and scheduled_at <= p_now)
       or (status = 'failed' and retry_count < 5 and retry_at is not null and retry_at <= p_now)
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update public.posts as p
  set status = 'processing'
  from candidates
  where p.id = candidates.id
  returning p.*;
end;
$$;

revoke all on function public.claim_due_posts(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_posts(timestamptz, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('postflow-media', 'postflow-media', true, 52428800, array['image/jpeg','image/png','image/webp','video/mp4'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
