// Genera database/005_seed_knowledge.sql a partir de database/knowledge/**/*.md
// Uso: node scripts/build-knowledge-seed.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kdir = join(root, 'database', 'knowledge');

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function parse(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Frontmatter inválido en ${file}`);
  const meta = Object.fromEntries(
    m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]),
  );
  return { slug: basename(file, '.md'), ...meta, contenido: m[2].trim() };
}

const docs = [];
for (const cat of readdirSync(kdir)) {
  const d = join(kdir, cat);
  if (!statSync(d).isDirectory()) continue;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.md')).sort()) docs.push(parse(join(d, f)));
}

const rows = docs.map(
  (d) => `  (${lit(d.slug)}, ${lit(d.categoria)}, ${lit(d.titulo)}, ${lit(d.contenido)}, ${lit(d.claves ?? '')}, ${lit(d.fuente)}, ${lit(d.autor)}, ${lit(d.actualizado)})`,
);

const sql = `-- =====================================================================
-- IRONCART · Base de conocimiento para RAG (GENERADO, no editar a mano)
-- Fuente: database/knowledge/**/*.md  ->  node scripts/build-knowledge-seed.mjs
-- ${docs.length} fragmentos. Contenido educativo parafraseado de fuentes públicas
-- citadas en la columna "fuente"; políticas de autoría propia (tienda de demo).
-- =====================================================================
insert into public.documento_conocimiento (slug, categoria, titulo, contenido, claves, fuente, autor, actualizado) values
${rows.join(',\n')}
on conflict (slug) do update set
  categoria = excluded.categoria, titulo = excluded.titulo, contenido = excluded.contenido, claves = excluded.claves,
  fuente = excluded.fuente, autor = excluded.autor, actualizado = excluded.actualizado;

-- Si 003_pgvector.sql está aplicado, los documentos modificados deben re-vectorizarse:
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'documento_conocimiento' and column_name = 'embedding_modelo') then
    execute 'update public.documento_conocimiento set embedding_modelo = null where embedding_modelo is not null and slug in (' ||
            (select string_agg(quote_literal(s), ',') from unnest(array[${docs.map((d) => lit(d.slug)).join(',')}]) s) || ')';
  end if;
end $$;
`;
writeFileSync(join(root, 'database', '005_seed_knowledge.sql'), sql);
console.log(`OK: ${docs.length} documentos -> database/005_seed_knowledge.sql`);

// Paquete único para pegar en el SQL Editor de Supabase (sin pgvector, que es opcional).
const parts = ['001_schema.sql', '002_functions.sql', '004_seed_catalog.sql', '005_seed_knowledge.sql']
  .map((f) => `-- >>>>>>>>>>>>>>>>>>>> ${f}\n` + readFileSync(join(root, 'database', f), 'utf8'));
writeFileSync(join(root, 'database', 'supabase_todo_en_uno.sql'),
  '-- IRONCART · instalación completa (generado por scripts/build-knowledge-seed.mjs)\n' +
  '-- Pégalo en Supabase → SQL Editor → Run. Es idempotente: se puede ejecutar de nuevo.\n\n' + parts.join('\n\n'));
console.log('OK: database/supabase_todo_en_uno.sql');
