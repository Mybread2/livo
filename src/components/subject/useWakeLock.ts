"use client";

import { useEffect } from "react";

// 화면을 켠 채로 유지한다(docs/UI_GUIDE.md · ADR-006).
// 브라우저는 화면이 꺼지면 카메라를 멈추므로, 대상자 화면에서는 Wake Lock을 건다.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;

    const request = async () => {
      try {
        // navigator.wakeLock 은 일부 브라우저에만 있다.
        const anyNav = navigator as Navigator & {
          wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
        };
        if (anyNav.wakeLock) {
          lock = await anyNav.wakeLock.request("screen");
        }
      } catch {
        // 실패해도 화면 동작 자체는 계속된다.
      }
    };

    void request();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !released) void request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
