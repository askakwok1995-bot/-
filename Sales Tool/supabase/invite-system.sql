create extension if not exists pgcrypto;

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  plan_type text not null check (plan_type in ('trial_3d', 'half_year', 'one_year', 'lifetime')),
  duration_days integer check (duration_days is null or duration_days > 0),
  status text not null default 'active' check (status in ('active', 'redeemed', 'disabled')),
  batch_label text not null default '',
  redeemed_by uuid unique,
  redeemed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_type text not null check (plan_type in ('trial_3d', 'half_year', 'one_year', 'lifetime')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null check (status in ('active', 'expired', 'revoked', 'grandfathered')),
  source_invite_id uuid references public.invite_codes (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_entitlements_lifetime_ends_at_chk
    check ((plan_type = 'lifetime' and ends_at is null) or (plan_type <> 'lifetime'))
);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_invite_codes_updated_at on public.invite_codes;
create trigger set_invite_codes_updated_at
before update on public.invite_codes
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists set_user_entitlements_updated_at on public.user_entitlements;
create trigger set_user_entitlements_updated_at
before update on public.user_entitlements
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.normalize_invite_code(candidate_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(candidate_code, ''), '[^A-Za-z0-9]+', '', 'g'));
$$;

create or replace function public.hash_invite_code(candidate_code text)
returns text
language sql
immutable
as $$
  select encode(digest(public.normalize_invite_code(candidate_code), 'sha256'), 'hex');
$$;

create or replace function public.calculate_entitlement_ends_at(starts_at timestamptz, plan_type text, duration_days integer)
returns timestamptz
language sql
immutable
as $$
  select
    case
      when coalesce(plan_type, '') = 'lifetime' then null
      when duration_days is null then null
      else starts_at + make_interval(days => duration_days)
    end;
$$;

create or replace function public.check_invite_code(candidate_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := public.normalize_invite_code(candidate_code);
  invite_row public.invite_codes%rowtype;
begin
  if normalized_code = '' then
    return jsonb_build_object(
      'valid', false,
      'plan_type', null,
      'duration_days', null,
      'message', '请输入有效邀请码。'
    );
  end if;

  select *
    into invite_row
  from public.invite_codes
  where code_hash = public.hash_invite_code(normalized_code)
  limit 1;

  if not found then
    return jsonb_build_object(
      'valid', false,
      'plan_type', null,
      'duration_days', null,
      'message', '邀请码无效或不存在。'
    );
  end if;

  if invite_row.status <> 'active' or invite_row.redeemed_by is not null then
    return jsonb_build_object(
      'valid', false,
      'plan_type', invite_row.plan_type,
      'duration_days', invite_row.duration_days,
      'message', '邀请码已失效或已被使用。'
    );
  end if;

  return jsonb_build_object(
    'valid', true,
    'plan_type', invite_row.plan_type,
    'duration_days', invite_row.duration_days,
    'message', ''
  );
end;
$$;

revoke execute on function public.check_invite_code(text) from public, anon, authenticated;

create or replace function public.has_active_entitlement(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_entitlements
    where user_id = target_user_id
      and status in ('active', 'grandfathered')
      and starts_at <= timezone('utc', now())
      and (ends_at is null or ends_at > timezone('utc', now()))
  );
$$;

grant execute on function public.has_active_entitlement(uuid) to authenticated;

create or replace function public.get_current_entitlement_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  entitlement_row public.user_entitlements%rowtype;
  now_utc timestamptz := timezone('utc', now());
begin
  select *
    into entitlement_row
  from public.user_entitlements
  where user_id = auth.uid()
  limit 1;

  if not found then
    return jsonb_build_object(
      'is_active', false,
      'reason', 'missing',
      'status', 'missing',
      'plan_type', null,
      'starts_at', null,
      'ends_at', null,
      'message', '当前账号未开通可用授权，请联系管理员处理。'
    );
  end if;

  if entitlement_row.status = 'revoked' then
    return jsonb_build_object(
      'is_active', false,
      'reason', 'revoked',
      'status', entitlement_row.status,
      'plan_type', entitlement_row.plan_type,
      'starts_at', entitlement_row.starts_at,
      'ends_at', entitlement_row.ends_at,
      'message', '当前账号授权已停用，请联系管理员处理。'
    );
  end if;

  if entitlement_row.starts_at > now_utc then
    return jsonb_build_object(
      'is_active', false,
      'reason', 'not_started',
      'status', entitlement_row.status,
      'plan_type', entitlement_row.plan_type,
      'starts_at', entitlement_row.starts_at,
      'ends_at', entitlement_row.ends_at,
      'message', '当前账号授权尚未生效，请稍后再试。'
    );
  end if;

  if entitlement_row.status = 'expired' or (entitlement_row.ends_at is not null and entitlement_row.ends_at <= now_utc) then
    return jsonb_build_object(
      'is_active', false,
      'reason', 'expired',
      'status', 'expired',
      'plan_type', entitlement_row.plan_type,
      'starts_at', entitlement_row.starts_at,
      'ends_at', entitlement_row.ends_at,
      'message', case
        when entitlement_row.ends_at is not null then format('当前账号授权已于 %s 到期，请联系管理员续费。', entitlement_row.ends_at)
        else '当前账号授权已到期，请联系管理员续费。'
      end
    );
  end if;

  return jsonb_build_object(
    'is_active', true,
    'reason', case when entitlement_row.status = 'grandfathered' then 'grandfathered' else 'active' end,
    'status', entitlement_row.status,
    'plan_type', entitlement_row.plan_type,
    'starts_at', entitlement_row.starts_at,
    'ends_at', entitlement_row.ends_at,
    'message', ''
  );
end;
$$;

revoke execute on function public.get_current_entitlement_status() from public, anon;
grant execute on function public.get_current_entitlement_status() to authenticated;

create or replace function public.redeem_invite_code_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_code text := coalesce(new.raw_user_meta_data ->> 'invite_code', '');
  normalized_code text := public.normalize_invite_code(invite_code);
  invite_row public.invite_codes%rowtype;
  entitlement_starts_at timestamptz := timezone('utc', now());
  entitlement_ends_at timestamptz;
begin
  if exists (select 1 from public.user_entitlements where user_id = new.id) then
    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code'
    where id = new.id;
    return new;
  end if;

  if normalized_code = '' then
    raise exception '注册需要有效邀请码。';
  end if;

  select *
    into invite_row
  from public.invite_codes
  where code_hash = public.hash_invite_code(normalized_code)
  for update;

  if not found then
    raise exception '邀请码无效或不存在。';
  end if;

  if invite_row.status <> 'active' or invite_row.redeemed_by is not null then
    raise exception '邀请码已失效或已被使用。';
  end if;

  entitlement_ends_at := public.calculate_entitlement_ends_at(
    entitlement_starts_at,
    invite_row.plan_type,
    invite_row.duration_days
  );

  insert into public.user_entitlements (
    user_id,
    plan_type,
    starts_at,
    ends_at,
    status,
    source_invite_id
  )
  values (
    new.id,
    invite_row.plan_type,
    entitlement_starts_at,
    entitlement_ends_at,
    'active',
    invite_row.id
  );

  update public.invite_codes
  set
    status = 'redeemed',
    redeemed_by = new.id,
    redeemed_at = entitlement_starts_at
  where id = invite_row.id;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code'
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists redeem_invite_code_for_new_user on auth.users;
create trigger redeem_invite_code_for_new_user
after insert on auth.users
for each row
execute function public.redeem_invite_code_for_new_user();

create or replace function public.strip_consumed_invite_code_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'invite_code'
    and exists (select 1 from public.user_entitlements where user_id = new.id) then
    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code'
    where id = new.id
      and coalesce(raw_user_meta_data, '{}'::jsonb) ? 'invite_code';
  end if;

  return new;
end;
$$;

drop trigger if exists strip_consumed_invite_code_metadata on auth.users;
create trigger strip_consumed_invite_code_metadata
after update of raw_user_meta_data on auth.users
for each row
when (coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'invite_code')
execute function public.strip_consumed_invite_code_metadata();

create or replace function public.backfill_grandfathered_entitlements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.user_entitlements (
    user_id,
    plan_type,
    starts_at,
    ends_at,
    status,
    source_invite_id
  )
  select
    users.id,
    'lifetime',
    coalesce(users.created_at, timezone('utc', now())),
    null,
    'grandfathered',
    null
  from auth.users as users
  left join public.user_entitlements entitlements
    on entitlements.user_id = users.id
  where entitlements.user_id is null;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

alter table public.invite_codes enable row level security;
alter table public.user_entitlements enable row level security;

revoke all on public.invite_codes from anon, authenticated;
grant select on public.user_entitlements to authenticated;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own
on public.user_entitlements
for select
to authenticated
using (auth.uid() = user_id);

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('products', 'sales_records', 'sales_targets')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$$;

alter table if exists public.products enable row level security;
alter table if exists public.sales_records enable row level security;
alter table if exists public.sales_targets enable row level security;

create policy products_select_own_active
on public.products
for select
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy products_insert_own_active
on public.products
for insert
to authenticated
with check (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy products_update_own_active
on public.products
for update
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()))
with check (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy products_delete_own_active
on public.products
for delete
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_records_select_own_active
on public.sales_records
for select
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_records_insert_own_active
on public.sales_records
for insert
to authenticated
with check (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_records_update_own_active
on public.sales_records
for update
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()))
with check (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_records_delete_own_active
on public.sales_records
for delete
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_targets_select_own_active
on public.sales_targets
for select
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_targets_insert_own_active
on public.sales_targets
for insert
to authenticated
with check (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_targets_update_own_active
on public.sales_targets
for update
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()))
with check (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

create policy sales_targets_delete_own_active
on public.sales_targets
for delete
to authenticated
using (auth.uid() = user_id and public.has_active_entitlement(auth.uid()));

select public.backfill_grandfathered_entitlements();

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code'
where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'invite_code'
  and exists (
    select 1
    from public.user_entitlements
    where user_id = auth.users.id
  );
