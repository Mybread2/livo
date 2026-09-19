"use client";

import { useEffect, useState } from "react";

// 오프라인 배너(와이어프레임 s33). 보호자 화면 상단에 뜬다.
// 문장 추가·목소리 등록·교체는 인터넷이 필요하지만, 대상자 발화는 영향받지 않는다는 걸 알린다.
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      style={{
        background: "#15161a",
        color: "#fff",
        padding: "10px 14px",
        fontSize: 12.5,
        lineHeight: 1.4,
      }}
    >
      인터넷에 연결되지 않았습니다. 문장 추가·목소리 설정은 지금 할 수 없지만, 대상자의 문장 발화는 평소와 같습니다.
    </div>
  );
}
