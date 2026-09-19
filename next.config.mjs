/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 대상자 화면의 고정 문장 경로는 단말에서 네트워크 없이 완결한다(CLAUDE.md CRITICAL).
  // 서버 API(src/app/api)는 보호자 경로 전용이며 Node Runtime을 쓴다.
  experimental: {
    // MediaPipe/ONNX 등 브라우저 전용 WASM 번들을 위한 여지. 필요 시 확장한다.
  },
};

export default nextConfig;
