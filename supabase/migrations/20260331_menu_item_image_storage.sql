insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-item-images',
  'menu-item-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read menu item images'
  ) then
    create policy "Public read menu item images"
      on storage.objects
      for select
      to public
      using (bucket_id = 'menu-item-images');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated upload menu item images'
  ) then
    create policy "Authenticated upload menu item images"
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'menu-item-images');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated update menu item images'
  ) then
    create policy "Authenticated update menu item images"
      on storage.objects
      for update
      to authenticated
      using (bucket_id = 'menu-item-images')
      with check (bucket_id = 'menu-item-images');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated delete menu item images'
  ) then
    create policy "Authenticated delete menu item images"
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'menu-item-images');
  end if;
end
$$;
