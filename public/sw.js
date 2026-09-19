// 입모아 서비스워커.
// 목적: 대상자 화면 인식에 필요한 /mediapipe/** (WASM + 얼굴 모델)를 오프라인에서도 쓰게 캐시한다.
// 그 밖의 요청은 건드리지 않는다(네트워크 그대로) — Next.js 라우팅과 충돌하지 않게.
// 목소리 오디오는 앱이 별도 Cache Storage(livo-voice)로 관리한다.

const CACHE = "ipmoa-mediapipe-v1";
const PRECACHE = [
  "/mediapipe/face_landmarker.task",
  "/mediapipe/wasm/vision_wasm_internal.js",
  "/mediapipe/wasm/vision_wasm_internal.wasm",
  "/mediapipe/wasm/vision_wasm_nosimd_internal.js",
  "/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
];

self.addEventListener("install", (event) => {
  // 첫 온라인 방문에 미리 받아 둔다 — 이후 비행기 모드에서도 인식 모델을 쓴다.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith("ipmoa-mediapipe")).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/mediapipe/")) {
    return; // 나머지는 브라우저 기본 동작
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }),
  );
});
