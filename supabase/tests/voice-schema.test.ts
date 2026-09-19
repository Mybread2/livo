import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./pglite";

function ids(hex: string) {
  const id = (n: number) => `${hex.repeat(8)}-0000-0000-0000-00000000000${n}`;
  return { user: id(1), account: id(2), subject: id(3), consent: id(4), profile: id(5) };
}
const A = ids("a");
const B = ids("b");

// superuser로 시드한다 (RLS 우회)
async function seed(db: PGlite, s: ReturnType<typeof ids>) {
  await db.query("insert into auth.users (id) values ($1)", [s.user]);
  await db.query("insert into public.accounts (id, user_id) values ($1, $2)", [s.account, s.user]);
  await db.query(
    "insert into public.subjects (id, account_id, display_name) values ($1, $2, '대상자')",
    [s.subject, s.account],
  );
  await db.query(
    `insert into public.consents (id, subject_id, kind, granted_by, doc_version)
     values ($1, $2, 'voice_family', 'family', 'v1')`,
    [s.consent, s.subject],
  );
  await db.query(
    `insert into public.voice_profiles (id, subject_id, source, provider_voice_id, consent_id)
     values ($1, $2, 'family', 'el_voice', $3)`,
    [s.profile, s.subject, s.consent],
  );
  await db.query(
    `insert into public.phrase_audio (subject_id, phrase_id, voice_profile_id, audio_path, char_count)
     values ($1, 'pain', $2, 'pain.mp3', 3)`,
    [s.subject, s.profile],
  );
  await db.query(
    "insert into storage.objects (bucket_id, name, owner) values ('voice-refs', $1, $2), ('phrase-audio', $1, $2)",
    [`${s.subject}/pain.mp3`, s.user],
  );
}

function insertProfile(db: PGlite, subjectId: string, consentId: string | null, source = "family") {
  return db.query(
    `insert into public.voice_profiles (subject_id, source, provider_voice_id, consent_id)
     values ($1, $2, 'el_voice', $3)`,
    [subjectId, source, consentId],
  );
}

function insertConsent(db: PGlite, subjectId: string) {
  return db.query(
    `insert into public.consents (subject_id, kind, granted_by, doc_version)
     values ($1, 'voice_self', 'self', 'v1')`,
    [subjectId],
  );
}

describe("voice schema", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, A);
    await seed(db, B);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("마이그레이션이 적용되어 5개 테이블 모두 RLS가 켜지고 private bucket 2개가 생긴다", async () => {
    const { rows: tables } = await db.query(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    );
    expect(tables).toEqual(
      ["accounts", "consents", "phrase_audio", "subjects", "voice_profiles"].map((relname) => ({
        relname,
        relrowsecurity: true,
      })),
    );

    const { rows: buckets } = await db.query("select id, public from storage.buckets order by id");
    expect(buckets).toEqual([
      { id: "phrase-audio", public: false },
      { id: "voice-refs", public: false },
    ]);
  });

  it.each([
    ["subjects", "id"],
    ["consents", "subject_id"],
    ["voice_profiles", "subject_id"],
    ["phrase_audio", "subject_id"],
  ])("사용자 A는 B의 %s를 0행 조회하고 자기 것은 본다", async (table, col) => {
    const count = (subjectId: string) =>
      asUser(db, A.user, async () => {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from public.${table} where ${col} = $1`,
          [subjectId],
        );
        return rows[0].n;
      });
    expect(await count(B.subject)).toBe(0);
    expect(await count(A.subject)).toBeGreaterThan(0);
  });

  it("consent_id 없이 voice_profiles를 만들 수 없다", async () => {
    await expect(insertProfile(db, A.subject, null)).rejects.toThrow(/null value in column "consent_id"/);
  });

  it("다른 대상자의 동의로 voice_profiles를 만들 수 없다", async () => {
    await expect(insertProfile(db, A.subject, B.consent)).rejects.toThrow(/foreign key/);
  });

  it("프리셋은 voice_profiles에 넣을 수 없다", async () => {
    await expect(insertProfile(db, A.subject, A.consent, "preset")).rejects.toThrow(/voice_profiles_source_check/);
  });

  it("authenticated는 자기 대상자라도 voice_profiles·phrase_audio에 쓸 수 없다", async () => {
    await asUser(db, A.user, async () => {
      await expect(insertProfile(db, A.subject, A.consent)).rejects.toThrow(/row-level security/);
      await expect(
        db.query(
          `insert into public.phrase_audio (subject_id, phrase_id, voice_profile_id, audio_path, char_count)
           values ($1, 'water', $2, 'water.mp3', 3)`,
          [A.subject, A.profile],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("authenticated는 자기 대상자의 동의만 기록할 수 있다", async () => {
    await asUser(db, A.user, async () => {
      expect((await insertConsent(db, A.subject)).affectedRows).toBe(1);
      await expect(insertConsent(db, B.subject)).rejects.toThrow(/row-level security/);
    });
  });

  it("authenticated는 voice-refs·phrase-audio 객체를 조회·업로드할 수 없다", async () => {
    await asUser(db, A.user, async () => {
      const { rows } = await db.query(
        "select id from storage.objects where bucket_id in ('voice-refs', 'phrase-audio')",
      );
      expect(rows).toHaveLength(0);
      for (const bucket of ["voice-refs", "phrase-audio"]) {
        await expect(
          db.query("insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)", [
            bucket,
            `${A.subject}/water.mp3`,
            A.user,
          ]),
        ).rejects.toThrow(/row-level security/);
      }
    });
  });
});
