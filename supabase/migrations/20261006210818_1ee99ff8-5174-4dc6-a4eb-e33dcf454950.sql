grant insert on public.contacts to authenticated;

create or replace function private.guard_contact_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email_norm := lower(trim(new.email));
  if new.subscription_status = 'subscribed' then
    if new.consent_given_at is null
       or exists (select 1 from public.suppressions s
                  where s.workspace_id = new.workspace_id and s.email_norm = new.email_norm) then
      new.subscription_status := 'unsubscribed';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_contact_subscription
before insert or update on public.contacts
for each row execute function private.guard_contact_subscription();

create unique index if not exists contacts_workspace_email_uniq on public.contacts (workspace_id, email_norm);