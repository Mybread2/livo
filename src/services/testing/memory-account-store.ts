import type { AccountRow, AccountStore, SubjectRow } from "../account-store";

// 테스트용 인메모리 스토어.
export function createMemoryAccountStore(): AccountStore & {
  accounts: AccountRow[];
  subjects: SubjectRow[];
} {
  const accounts: AccountRow[] = [];
  const subjects: SubjectRow[] = [];
  let seq = 0;
  const id = (p: string) => `${p}-${(seq += 1)}`;

  return {
    accounts,
    subjects,
    async getAccountByUser(userId) {
      return accounts.find((a) => a.userId === userId) ?? null;
    },
    async createAccount(userId) {
      const row = { id: id("acc"), userId };
      accounts.push(row);
      return row;
    },
    async listSubjects(accountId) {
      return subjects.filter((s) => s.accountId === accountId);
    },
    async createSubject(accountId, displayName) {
      const row = {
        id: id("sub"),
        accountId,
        displayName,
        triggerMode: "auto",
      };
      subjects.push(row);
      return row;
    },
  };
}
