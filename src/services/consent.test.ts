import { describe, it, expect } from "vitest";
import {
  recordConsents,
  MissingRequiredConsentError,
  REQUIRED_CONSENTS,
} from "./consent";
import type { ConsentInput, ConsentStore } from "./consent-store";

function memoryStore() {
  const rows: ConsentInput[] = [];
  const store: ConsentStore = {
    async insertConsents(input) {
      rows.push(...input);
    },
  };
  return { store, rows };
}

describe("recordConsents", () => {
  it("필수 동의가 다 있으면 기록한다", async () => {
    const { store, rows } = memoryStore();
    await recordConsents(store, {
      subjectId: "s1",
      grantedKinds: ["biometric", "voice_self"],
      grantedBy: "self",
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.subjectId === "s1")).toBe(true);
    expect(rows.every((r) => r.docVersion === "v1")).toBe(true);
  });

  it("선택 동의도 함께 기록한다", async () => {
    const { store, rows } = memoryStore();
    await recordConsents(store, {
      subjectId: "s1",
      grantedKinds: ["biometric", "voice_self", "overseas_transfer"],
      grantedBy: "legal_guardian",
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.grantedBy === "legal_guardian")).toBe(true);
  });

  it("필수 동의가 빠지면 거부하고 아무것도 기록하지 않는다", async () => {
    const { store, rows } = memoryStore();
    await expect(
      recordConsents(store, {
        subjectId: "s1",
        grantedKinds: ["biometric"],
        grantedBy: "self",
      }),
    ).rejects.toBeInstanceOf(MissingRequiredConsentError);
    expect(rows).toHaveLength(0);
  });

  it("중복 동의는 한 번만 기록한다", async () => {
    const { store, rows } = memoryStore();
    await recordConsents(store, {
      subjectId: "s1",
      grantedKinds: [...REQUIRED_CONSENTS, "biometric"],
      grantedBy: "self",
    });
    expect(rows).toHaveLength(2);
  });
});
