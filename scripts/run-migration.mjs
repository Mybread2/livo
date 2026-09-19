// 일회성 마이그레이션 러너. 연결 문자열은 인자로 받는다(파일에 저장하지 않는다).
// 사용: node scripts/run-migration.mjs "<connection-string>" supabase/migrations/0001_init.sql
import { readFileSync } from "node:fs";
import pg from "pg";

const [connStr, sqlPath] = process.argv.slice(2);
if (!connStr || !sqlPath) {
  console.error("usage: node run-migration.mjs <conn> <sqlPath>");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString: connStr });

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    `select tablename from pg_tables where schemaname='public' order by tablename`,
  );
  console.log("OK. public tables:", rows.map((r) => r.tablename).join(", "));
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
