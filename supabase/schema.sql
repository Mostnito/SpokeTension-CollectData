-- Run once in the SQL editor of your Supabase project.
-- The application API uses the server-only service role key. No client login is required.
begin;

create table if not exists public.recordings (
  id uuid primary key,
  schema_version smallint not null default 1 check (schema_version = 1),
  created_at timestamptz not null default now(),
  recorded_at timestamptz not null,
  recorder text not null check (recorder in ('Most', 'Alexander', 'Sally', 'Devolia')),
  wheel_type text not null check (wheel_type in ('front', 'rear')),
  spoke_length_mm double precision not null check (spoke_length_mm > 0 and spoke_length_mm < 'Infinity'::double precision),
  spoke_diameter_mm double precision not null check (spoke_diameter_mm > 0 and spoke_diameter_mm < 'Infinity'::double precision),
  tension_kgf double precision not null check (tension_kgf > 0 and tension_kgf < 'Infinity'::double precision),
  temperature_c double precision not null check (temperature_c >= -273.15 and temperature_c < 'Infinity'::double precision),
  environment text not null check (environment in ('quiet', 'noisy')),
  duration_ms bigint not null check (duration_ms > 0),
  sample_rate_hz integer not null check (sample_rate_hz > 0),
  channels smallint not null check (channels = 1),
  bitrate_kbps smallint not null check (bitrate_kbps = 192),
  audio_path text not null unique check (audio_path = id::text || '.mp3'),
  audio_size_bytes bigint not null check (audio_size_bytes > 0 and audio_size_bytes <= 50000000),
  audio_mime text not null default 'audio/mpeg' check (audio_mime = 'audio/mpeg')
);

create index if not exists recordings_created_at_id_idx on public.recordings (created_at desc, id desc);
alter table public.recordings enable row level security;
revoke all on table public.recordings from anon, authenticated;
grant select, insert, delete on table public.recordings to service_role;

-- Do not create public SELECT/INSERT policies for this table or storage.objects.
-- Only the Express API issues short-lived upload and download links.
-- The 50 MB ceiling matches the default Supabase Free upload limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spoke-recordings', 'spoke-recordings', false, 50000000, array['audio/mpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
