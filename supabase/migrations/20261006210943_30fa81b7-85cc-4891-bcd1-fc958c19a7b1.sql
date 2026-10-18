create policy "signed-in visitors view published forms" on public.forms
  for select to authenticated using (status = 'published');
create policy "signed-in visitors view live published versions" on public.form_versions
  for select to authenticated using (exists (select 1 from public.forms f where f.id = form_versions.form_id and f.status = 'published' and f.published_version_id = form_versions.id));