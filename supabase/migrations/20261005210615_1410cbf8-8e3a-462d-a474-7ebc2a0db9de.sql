-- Sunshade core schema
create type public.app_role as enum ('owner', 'admin', 'member');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  plan text not null default 'beta_free',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role public.app_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Security definer helpers (avoid RLS recursion)
create or replace function public.current_workspace_role(_workspace_id uuid)
returns public.app_role
language sql stable security definer set search_path = public as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id = _workspace_id and wm.user_id = auth.uid()
$$;

create or replace function public.is_workspace_member(_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_workspace_role(_workspace_id) is not null
$$;

create or replace function public.handle_new_workspace()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_workspace_created
after insert on public.workspaces
for each row execute function public.handle_new_workspace();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'Untitled form' check (char_length(title) between 1 and 200),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  theme jsonb not null default '{}'::jsonb,
  capture_contact boolean not null default false,
  draft jsonb not null default '{"fields": []}'::jsonb,
  published_version_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  version_number int not null,
  definition jsonb not null,
  published_at timestamptz not null default now(),
  unique (form_id, version_number)
);

alter table public.forms
  add constraint forms_published_version_fkey
  foreign key (published_version_id) references public.form_versions(id) on delete set null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_norm text not null,
  name text,
  source text not null default 'manual',
  form_id uuid references public.forms(id) on delete set null,
  tags text[] not null default '{}',
  subscription_status text not null default 'unsubscribed' check (subscription_status in ('subscribed', 'unsubscribed')),
  consent_given_at timestamptz,
  consent_version text,
  consent_source text,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email_norm)
);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email_norm text not null,
  reason text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  source text,
  created_at timestamptz not null default now(),
  unique (workspace_id, email_norm, reason)
);

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  version_id uuid not null references public.form_versions(id),
  answers jsonb not null,
  contact_id uuid references public.contacts(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  filter jsonb not null default '{"tags": [], "sources": [], "subscription_status": "subscribed"}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Untitled campaign',
  subject text not null default '',
  preview_text text not null default '',
  body text not null default '',
  segment_id uuid references public.segments(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{read}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index contacts_workspace_idx on public.contacts (workspace_id, email_norm);
create index responses_workspace_form_idx on public.form_responses (workspace_id, form_id, submitted_at desc);
create index forms_workspace_idx on public.forms (workspace_id);
create index suppressions_workspace_idx on public.suppressions (workspace_id, email_norm);
create index agent_tokens_workspace_idx on public.agent_tokens (workspace_id, token_hash);

-- updated_at triggers
create trigger touch_workspaces_updated before update on public.workspaces
for each row execute function public.touch_updated_at();
create trigger touch_forms_updated before update on public.forms
for each row execute function public.touch_updated_at();
create trigger touch_contacts_updated before update on public.contacts
for each row execute function public.touch_updated_at();
create trigger touch_segments_updated before update on public.segments
for each row execute function public.touch_updated_at();
create trigger touch_campaigns_updated before update on public.campaigns
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.forms to authenticated;
grant select, insert, update, delete on public.form_versions to authenticated;
grant select, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.suppressions to authenticated;
grant select, delete on public.form_responses to authenticated;
grant select, insert, update, delete on public.segments to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.agent_tokens to authenticated;
grant all on all tables in schema public to service_role;
-- Only published form definitions are publicly readable; responses, contacts and tokens are not.
grant select on public.forms to anon;
grant select on public.form_versions to anon;

-- ------------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.forms enable row level security;
alter table public.form_versions enable row level security;
alter table public.contacts enable row level security;
alter table public.suppressions enable row level security;
alter table public.form_responses enable row level security;
alter table public.segments enable row level security;
alter table public.campaigns enable row level security;
alter table public.agent_tokens enable row level security;

create policy "members manage own workspaces" on public.workspaces
  for all to authenticated
  using (public.is_workspace_member(id))
  with check (
    (id is null and created_by = auth.uid())
    or (public.is_workspace_member(id) and public.current_workspace_role(id) <> 'member')
  );

create policy "members see team rosters" on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy "admins manage team roster" on public.workspace_members
  for all to authenticated
  using (public.current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy "members manage workspace forms" on public.forms
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (
    (public.is_workspace_member(workspace_id) and (created_by = auth.uid() or created_by is null))
    or public.current_workspace_role(workspace_id) is not null
  );

create policy "anyone can view published forms" on public.forms
  for select to anon using (status = 'published');

create policy "members manage published versions" on public.form_versions
  for all to authenticated
  using (public.is_workspace_member((select f.workspace_id from public.forms f where f.id = form_id)))
  with check (public.is_workspace_member((select f.workspace_id from public.forms f where f.id = form_id)));

create policy "anyone can view live published versions" on public.form_versions
  for select to anon using (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.status = 'published'
        and f.published_version_id = form_versions.id
    )
  );

create policy "members manage contacts" on public.contacts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members manage suppressions" on public.suppressions
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members view responses" on public.form_responses
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "admins archive responses" on public.form_responses
  for delete to authenticated
  using (public.current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy "members manage segments" on public.segments
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "members manage campaigns" on public.campaigns
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "admins manage agent tokens" on public.agent_tokens
  for all to authenticated
  using (public.current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.current_workspace_role(workspace_id) in ('owner', 'admin'));
