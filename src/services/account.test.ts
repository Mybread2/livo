import { describe, it, expect } from "vitest";
import { ensureAccount, addSubject, InvalidSubjectNameError } from "./account";
import { createMemoryAccountStore } from "./testing/memory-account-store";

describe("ensureAccount", () => {
  it("계정이 없으면 새로 만든다", async () => {
    const store = createMemoryAccountStore();
    const acc = await ensureAccount(store, "user-1");
    expect(acc.userId).toBe("user-1");
    expect(store.accounts).toHaveLength(1);
  });

  it("이미 있으면 재사용한다(중복 생성 안 함)", async () => {
    const store = createMemoryAccountStore();
    const first = await ensureAccount(store, "user-1");
    const second = await ensureAccount(store, "user-1");
    expect(second.id).toBe(first.id);
    expect(store.accounts).toHaveLength(1);
  });
});

describe("addSubject", () => {
  it("대상자를 만든다", async () => {
    const store = createMemoryAccountStore();
    const acc = await ensureAccount(store, "user-1");
    const sub = await addSubject(store, acc.id, "김O수");
    expect(sub.displayName).toBe("김O수");
    expect(sub.triggerMode).toBe("auto");
  });

  it("이름 앞뒤 공백을 다듬는다", async () => {
    const store = createMemoryAccountStore();
    const acc = await ensureAccount(store, "user-1");
    const sub = await addSubject(store, acc.id, "  박O자  ");
    expect(sub.displayName).toBe("박O자");
  });

  it("공백만이면 거부한다", async () => {
    const store = createMemoryAccountStore();
    const acc = await ensureAccount(store, "user-1");
    await expect(addSubject(store, acc.id, "   ")).rejects.toBeInstanceOf(
      InvalidSubjectNameError,
    );
  });
});
