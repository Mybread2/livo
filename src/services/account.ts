import type { AccountRow, AccountStore, SubjectRow } from "./account-store";

export class InvalidSubjectNameError extends Error {
  constructor() {
    super("대상자 이름이 비어 있다");
    this.name = "InvalidSubjectNameError";
  }
}

// 로그인한 사용자에게 계정 행이 없으면 만든다(계정 1 : 대상자 N). 이미 있으면 그대로 돌려준다.
export async function ensureAccount(
  store: AccountStore,
  userId: string,
): Promise<AccountRow> {
  const existing = await store.getAccountByUser(userId);
  if (existing) return existing;
  return store.createAccount(userId);
}

// 대상자 추가. 이름은 공백만이면 거부한다.
export async function addSubject(
  store: AccountStore,
  accountId: string,
  displayName: string,
): Promise<SubjectRow> {
  const name = displayName.trim();
  if (name === "") throw new InvalidSubjectNameError();
  return store.createSubject(accountId, name);
}
