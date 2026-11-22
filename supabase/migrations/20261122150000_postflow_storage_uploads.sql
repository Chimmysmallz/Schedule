-- Allow signed-in Postflow users to upload media. The bucket remains public for social-platform fetches.
drop policy if exists "Authenticated users can upload Postflow media" on storage.objects;
create policy "Authenticated users can upload Postflow media"
on storage.objects for insert to authenticated
with check (bucket_id = 'postflow-media');
