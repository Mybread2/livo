import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

// 실제 Supabase에 이미 있는 role·schema를 흉내 낸다. 마이그레이션에는 넣지 않는다 — 호스티드에서 충돌한다.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;

-- Supabase와 같은 기본 권한. 테이블 권한은 열려 있고 RLS만이 장벽이어야 테스트가 RLS를 검증한다.
grant usage on schema public, storage, auth to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
