import "server-only";
import { cookies } from "next/headers";

// Server Component / Route Handler 에서 데모 쿠키 확인
export function isDemoMode(): boolean {
  try {
    return cookies().get("livo_demo")?.value === "1";
  } catch {
    return false;
  }
}
