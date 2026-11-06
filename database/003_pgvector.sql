-- =====================================================================
-- IRONCART · (Opcional) Búsqueda vectorial con pgvector
-- ---------------------------------------------------------------------
-- Aplicar en Supabase si se usará un proveedor de embeddings (VOYAGE_API_KEY).
-- Sin este archivo, Spot usa la recuperación textual (FTS) de 002_functions.sql.
-- Dimensión 1024 = salida por defecto de los modelos voyage-3.5 / voyage-3.5-lite.
-- Si cambias de modelo, ajusta la dimensión (vector(N)) y vuelve a generar embeddings.
-- =====================================================================
create extension if not exists vector with schema extensions;

alter table public.documento_conocimiento
  add column if not exists embedding extensions.vector(1024),
  add column if not exists embedding_modelo text;

create index if not exists documento_embedding_hnsw
  on public.documento_conocimiento using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.api_conocimiento_buscar_vector(p jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_emb extensions.vector(1024) := (p->>'embedding')::extensions.vector;
  v_lim int := least(greatest(coalesce((p->>'limite')::int, 4), 1), 8);
  v_res jsonb;
begin
  select coalesce(jsonb_agg(j order by s desc), '[]'::jsonb) into v_res from (
    select jsonb_build_object('id', d.id, 'slug', d.slug, 'titulo', d.titulo, 'categoria', d.categoria,
                              'contenido', d.contenido, 'fuente', d.fuente, 'actualizado', d.actualizado,
                              'score', round((1 - (d.embedding <=> v_emb))::numeric, 4)) as j,
           1 - (d.embedding <=> v_emb) as s
    from public.documento_conocimiento d
    where d.embedding is not null
    order by d.embedding <=> v_emb
    limit v_lim) t;
  return v_res;
end $$;

create or replace function public.api_conocimiento_pendientes(p jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'texto', d.titulo || E'\n\n' || d.contenido) order by d.id), '[]'::jsonb)
  from (select * from public.documento_conocimiento
        where embedding is null or embedding_modelo is distinct from p->>'modelo'
        order by id limit least(coalesce((p->>'limite')::int, 32), 64)) d
$$;

create or replace function public.api_conocimiento_guardar_embedding(p jsonb)
returns jsonb language sql security definer
set search_path = public, extensions
as $$
  with u as (
    update public.documento_conocimiento
    set embedding = (p->>'embedding')::extensions.vector, embedding_modelo = p->>'modelo'
    where id = (p->>'id')::int returning 1)
  select jsonb_build_object('ok', (select count(*) from u) = 1)
$$;

create or replace function public.api_conocimiento_estado_vectorial(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('total', count(*), 'con_embedding', count(embedding))
  from public.documento_conocimiento
$$;

do $$
declare f text;
begin
  foreach f in array array['api_conocimiento_buscar_vector(jsonb)','api_conocimiento_pendientes(jsonb)',
                           'api_conocimiento_guardar_embedding(jsonb)','api_conocimiento_estado_vectorial(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
