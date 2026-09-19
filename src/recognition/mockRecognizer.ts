import type {
  Recognizer,
  RecognitionEvent,
  RecognizerOptions,
} from "@/types/recognition";
import { PHRASES, STARTER_PHRASE_IDS, getPhrase } from "@/lib/phrases";
import { decideGate } from "./gate";

// 담당 A용 목(mock). 담당 B의 실제 Recognizer(MediaPipe → 구간검출 → 정규화 → 인식)가
// 완성되면 이 파일을 교체 없이 대체 구현으로 갈아끼운다.
// CRITICAL: 여기에 fetch·API 호출을 넣지 마라. 이 경로는 단말에서 완결한다.
//
// 목 동작: 몇 초마다 시작 단어 셋 중 하나를 무작위 확신도로 "인식"한 척한다.
export class MockRecognizer implements Recognizer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stream: MediaStream | null = null;

  async start(
    video: HTMLVideoElement,
    onResult: (event: RecognitionEvent) => void,
    options?: RecognizerOptions,
  ): Promise<void> {
    // 실제 카메라를 붙여 대기/프리뷰 흐름을 시연한다(프레임은 서버로 보내지 않는다).
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = this.stream;
      await video.play().catch(() => undefined);
    } catch {
      // 카메라 권한이 없어도 목 인식은 계속 흐른다(개발 편의).
    }

    let i = 0;
    this.timer = setInterval(() => {
      const id = STARTER_PHRASE_IDS[i % STARTER_PHRASE_IDS.length];
      i += 1;
      const phrase = getPhrase(id) ?? PHRASES[0];
      // 0.55 ~ 0.98 사이를 오가며 discard/show/speak 세 상태를 모두 시연한다.
      const score = 0.55 + ((i * 0.17) % 0.43);
      const gate = decideGate({ score, manualSession: options?.manualSession });
      onResult({ phraseId: phrase.id, text: phrase.text, score, gate });
    }, 3500);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}
