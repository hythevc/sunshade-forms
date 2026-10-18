-- Move RLS helper functions into a private, non-API schema
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create or replace function private.current_workspace_role(_workspace_id uuid)
returns public.app_role
language sql stable security definer set search_path = public as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id = _workspace_id and wm.user_id = auth.uid()
$$;

create or replace function private.is_workspace_member(_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select private.current_workspace_role(_workspace_id) is not null
$$;

create or replace function private.handle_new_workspace()
returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Drop dependent policies and triggers first

drop policy if exists "members manage own workspaces" on public.workspaces;
drop policy if exists "members see team rosters" on public.workspace_members;
drop policy if exists "admins manage team roster" on public.workspace_members;
drop policy if exists "members manage workspace forms" on public.forms;
drop policy if exists "anyone can view published forms" on public.forms;
drop policy if exists "members manage published versions" on public.form_versions;
drop policy if exists "anyone can view live published versions" on public.form_versions;
drop policy if exists "members manage contacts" on public.contacts;
drop policy if exists "members manage suppressions" on public.suppressions;
drop policy if exists "members view responses" on public.form_responses;
drop policy if exists "admins archive responses" on public.form_responses;
drop policy if exists "members manage segments" on public.segments;
drop policy if exists "members manage campaigns" on public.campaigns;
drop policy if exists "admins manage agent tokens" on public.agent_tokens;

drop trigger if exists on_workspace_created on public.workspaces;

-- Remove the publicly exposed versions
drop function if exists public.current_workspace_role(uuid);
drop function if exists public.is_workspace_member(uuid);
drop function if exists public.handle_new_workspace();

create trigger on_workspace_created
after insert on public.workspaces
for each row execute function private.handle_new_workspace();

-- Recreate policies against private helpers

create policy "workspaces select" on public.workspaces
  for select to authenticated using (private.is_workspace_member(id));
create policy "workspaces insert" on public.workspaces
  for insert to authenticated with check (created_by = auth.uid());
create policy "workspaces update" on public.workspaces
  for update to authenticated
  using (private.current_workspace_role(id) in ('owner', 'admin'))
  with check (private.current_workspace_role(id) in ('owner', 'admin'));
create policy "workspaces delete" on public.workspaces
  for delete to authenticated using (private.current_workspace_role(id) = 'owner');

create policy "members see team rosters" on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or private.is_workspace_member(workspace_id));

create policy "admins manage team roster" on public.workspace_members
  for all to authenticated
  using (private.current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (private.current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy "members manage workspace forms" on public.forms
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "anyone can view published forms" on public.forms
  for select to anon using (status = 'published');

create policy "members manage published versions" on public.form_versions
  for all to authenticated
  using (private.is_workspace_member((select f.workspace_id from public.forms f where f.id = form_id)))
  with check (private.is_workspace_member((select f.workspace_id from public.forms f where f.id = form_id)));

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
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "members manage suppressions" on public.suppressions
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "members view responses" on public.form_responses
  for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy "admins archive responses" on public.form_responses
  for delete to authenticated
  using (private.current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy "members manage segments" on public.segments
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "members manage campaigns" on public.campaigns
  for all to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

create policy "admins manage agent tokens" on public.agent_tokens
  for all to authenticated
  using (private.current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (private.current_workspace_role(workspace_id) in ('owner', 'admin'));
