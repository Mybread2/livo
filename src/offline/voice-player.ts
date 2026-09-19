import type { VoicePlayer } from "@/types/voice";
import type { VoiceBundle } from "@/types/voice-bundle";

const CACHE_NAME = "livo-voice";
const MANIFEST_KEY = "/livo-voice/active";

export interface AudioOutput {
  play(audio: Blob): Promise<void>; // 재생이 끝나면 resolve
  stop(): void; // 재생 중인 것을 멈춘다
}

export interface VoicePlayerDeps {
  fetchBundle: () => Promise<VoiceBundle>; // 통합 시 A가 GET /api/bundle/:subject_id 로 연결
  fetch?: typeof fetch; // 오디오 다운로드용. 기본 globalThis.fetch
  cache?: CacheStorage; // 기본 globalThis.caches
  output?: AudioOutput; // 기본: HTMLAudioElement + object URL
}

export interface SyncableVoicePlayer extends VoicePlayer {
  sync(): Promise<void>; // 번들을 받아 단말 저장소를 갱신
}

export class VoiceNotReadyError extends Error {
  constructor(phraseId: string) {
    super(`문장 오디오가 준비되지 않았다: ${phraseId}`);
    this.name = "VoiceNotReadyError";
  }
}

interface Manifest {
  version: string;
  phraseIds: string[];
}

// 서명 URL은 받을 때마다 바뀌므로 키로 쓰지 않는다
const audioKey = (version: string, phraseId: string) => `/livo-voice/${version}/${phraseId}`;

export async function createVoicePlayer(deps: VoicePlayerDeps): Promise<SyncableVoicePlayer> {
  const {
    fetchBundle,
    fetch: doFetch = globalThis.fetch,
    cache = globalThis.caches,
    output = sharedOutput(),
  } = deps;
  const store = await cache.open(CACHE_NAME);

  // 활성 버전 오디오를 메모리에 올려 둔다 — 발화 순간에 저장소를 뒤지지 않아야 지연 예산(약 0.6초)을 지킨다
  let active: Manifest | null = null;
  let audio = new Map<string, Blob>();
  const saved = await store.match(MANIFEST_KEY);
  if (saved) {
    active = (await saved.json()) as Manifest;
    for (const phraseId of active.phraseIds) {
      const res = await store.match(audioKey(active.version, phraseId));
      if (res) audio.set(phraseId, await res.blob());
    }
  }

  return {
    isReady: (phraseId) => audio.has(phraseId),

    // 네트워크를 쓰지 않는다. 최신 발화가 우선이다
    async speak(phraseId) {
      const blob = audio.get(phraseId);
      if (!blob) throw new VoiceNotReadyError(phraseId);
      output.stop();
      await output.play(blob);
    },

    async sync() {
      const bundle = await fetchBundle();
      if (bundle.version === active?.version && bundle.items.every(({ phraseId }) => audio.has(phraseId))) return;

      // 전부 받은 뒤에만 바꾼다. 하나라도 실패하면 이전 버전으로 계속 말한다 — 목소리 교체 중에도 발화가 끊기지 않게
      const downloaded = await Promise.all(
        bundle.items.map(async ({ phraseId, url }) => {
          const res = await doFetch(url);
          // 서명 URL은 메시지에 넣지 않는다
          if (!res.ok) throw new Error(`오디오 다운로드 실패: ${phraseId} (HTTP ${res.status})`);
          return [phraseId, await res.blob()] as const;
        }),
      );
      await Promise.all(
        downloaded.map(([phraseId, blob]) => store.put(audioKey(bundle.version, phraseId), new Response(blob))),
      );
      const next: Manifest = { version: bundle.version, phraseIds: downloaded.map(([phraseId]) => phraseId) };
      await store.put(MANIFEST_KEY, new Response(JSON.stringify(next)));

      const previous = active;
      active = next;
      audio = new Map<string, Blob>(downloaded);
      if (previous && previous.version !== next.version) {
        await Promise.all(previous.phraseIds.map((phraseId) => store.delete(audioKey(previous.version, phraseId))));
      }
    },
  };
}

// 자동재생 정책: 브라우저는 사용자 조작 없이 소리를 내지 못하게 막는다. iOS는 조작 안에서 한 번 재생된 요소만 이후 조작 없이 재생한다.
// 대상자 화면은 손을 쓰지 않으므로, 오디오 요소 하나를 계속 재사용하고 보호자의 터치 한 번(unlock)으로 그 요소의 재생 권한을 얻어 둔다.
export type AudioElementLike = Pick<HTMLAudioElement, "src" | "onended" | "onerror" | "play" | "pause">;

export interface UnlockableAudioOutput extends AudioOutput {
  unlock(): Promise<void>; // 사용자 조작(터치·키) 핸들러 안에서 불러야 한다 — play()를 동기로 먼저 부른다
}

// 8kHz 8bit 무음 10ms
const SILENT_WAV =
  "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

const objectUrls = {
  create: (blob: Blob) => URL.createObjectURL(blob),
  revoke: (url: string) => URL.revokeObjectURL(url),
};

// 재생이 끝나거나 멈추면 object URL을 해제한다
export function createAudioElementOutput(
  element: AudioElementLike,
  urls: { create(blob: Blob): string; revoke(url: string): void } = objectUrls,
): UnlockableAudioOutput {
  let stopCurrent: (() => void) | null = null;
  return {
    unlock() {
      if (stopCurrent) return Promise.resolve(); // 발화 중이면 이미 재생 권한이 있다 — 끊지 않는다
      element.onended = null;
      element.onerror = null;
      element.src = SILENT_WAV;
      return element.play().then(() => element.pause());
    },
    play(blob) {
      const url = urls.create(blob);
      element.src = url;
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          if (stopCurrent === stop) stopCurrent = null;
          urls.revoke(url);
          if (error) reject(error);
          else resolve();
        };
        // 멈춘 재생은 끝난 것으로 처리한다 — 이전 speak가 영원히 대기하지 않게
        const stop = () => {
          element.pause();
          finish();
        };
        stopCurrent = stop;
        element.onended = () => finish();
        element.onerror = () => finish(new Error("오디오 재생 실패"));
        element.play().catch(finish);
      });
    },
    stop() {
      stopCurrent?.();
    },
  };
}

// 첫 터치·키 입력에 unlock한다. 성공하면 리스너를 떼고, 막히면 다음 입력에 다시 시도한다.
// 새로고침으로 권한이 사라져도 보호자가 화면을 한 번 건드리면 소리가 돌아온다 (대상자에게 터치를 요구하지 않는다).
export function unlockOnFirstGesture(output: UnlockableAudioOutput, target: EventTarget): void {
  const events = ["pointerdown", "keydown"];
  const options = { capture: true }; // 화면 요소가 이벤트 전파를 막아도 받는다
  const handler = () => {
    output.unlock().then(
      () => events.forEach((type) => target.removeEventListener(type, handler, options)),
      () => {},
    );
  };
  events.forEach((type) => target.addEventListener(type, handler, options));
}

// 브라우저 전용. 모든 player가 요소 하나를 같이 쓴다 — 페이지 이동(클라이언트 라우팅) 뒤에도 얻어 둔 재생 권한이 유지된다
let shared: UnlockableAudioOutput | null = null;
function sharedOutput(): UnlockableAudioOutput {
  if (!shared) {
    shared = createAudioElementOutput(new Audio());
    unlockOnFirstGesture(shared, window);
  }
  return shared;
}

// 보호자가 대상자 화면을 여는 버튼의 onClick 안에서 부른다. 이후 대상자 화면은 터치 없이 소리를 낸다.
export function unlockVoiceOutput(): Promise<void> {
  return sharedOutput().unlock().catch(() => {});
}
