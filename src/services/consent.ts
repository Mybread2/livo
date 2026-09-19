import type {
  ConsentInput,
  ConsentKind,
  ConsentStore,
  GrantedBy,
} from "./consent-store";

// 온보딩에서 반드시 받아야 하는 필수 동의. 이게 없으면 대상자를 쓸 수 없다.
export const REQUIRED_CONSENTS: ConsentKind[] = ["biometric", "voice_self"];
// 온보딩에서 선택으로 받을 수 있는 동의.
export const OPTIONAL_CONSENTS: ConsentKind[] = ["overseas_transfer"];

export const CONSENT_DOC_VERSION = "v1";

export class MissingRequiredConsentError extends Error {
  missing: ConsentKind[];
  constructor(missing: ConsentKind[]) {
    super(`필수 동의 누락: ${missing.join(", ")}`);
    this.name = "MissingRequiredConsentError";
    this.missing = missing;
  }
}

export interface RecordConsentsInput {
  subjectId: string;
  /** 동의한 항목들(필수+선택 섞여도 됨). */
  grantedKinds: ConsentKind[];
  /** 법정대리인이 대신 동의하면 legal_guardian. */
  grantedBy: GrantedBy;
}

// 필수 동의가 모두 있는지 검증한 뒤 consents 행을 기록한다.
export async function recordConsents(
  store: ConsentStore,
  input: RecordConsentsInput,
): Promise<void> {
  const granted = new Set(input.grantedKinds);
  const missing = REQUIRED_CONSENTS.filter((k) => !granted.has(k));
  if (missing.length > 0) throw new MissingRequiredConsentError(missing);

  const rows: ConsentInput[] = [...granted].map((kind) => ({
    subjectId: input.subjectId,
    kind,
    grantedBy: input.grantedBy,
    docVersion: CONSENT_DOC_VERSION,
  }));
  await store.insertConsents(rows);
}
