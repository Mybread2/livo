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
    output = createAudioElementOutput(),
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

// 브라우저 전용. 재생이 끝나거나 멈추면 object URL을 해제한다
function createAudioElementOutput(): AudioOutput {
  let stopCurrent: (() => void) | null = null;
  return {
    play(blob) {
      const url = URL.createObjectURL(blob);
      const element = new Audio(url);
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          if (stopCurrent === stop) stopCurrent = null;
          URL.revokeObjectURL(url);
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
