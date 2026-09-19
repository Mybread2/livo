import type { Config } from "tailwindcss";

// 색 토큰은 와이어프레임(입모아 v1)에서 가져왔다.
// 포인트색(accent)은 보호자 화면의 "지금 눌러야 할 것 하나"와 "선택됨"에만 쓴다.
// 대상자 화면은 검정·흰색만 쓴다 — 여기에 accent를 쓰지 않는다.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#2A52BE",
        "accent-soft": "rgba(42,82,190,0.06)",
        ink: "#15161a",
        muted: "#6d707a",
        line: "rgba(21,22,26,0.13)",
        subject: "#0a0a0c", // 대상자 대기 화면 배경(순수 검정 계열)
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
