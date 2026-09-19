"use client";

import { useEffect } from "react";

// 서비스워커 등록. /mediapipe/** 오프라인 캐시를 위해서다(public/sw.js).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 등록 실패해도 온라인 동작에는 지장이 없다.
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
