import { describe, expect, it, vi } from "vitest";
import { PHRASES } from "@/lib/phrases";
import type { VoiceBundle } from "@/types/voice-bundle";
import {
  createAudioElementOutput,
  createVoicePlayer,
  unlockOnFirstGesture,
  VoiceNotReadyError,
  type AudioOutput,
} from "./voice-player";

const ALL = PHRASES.map((p) => p.id);
const CACHE_NAME = "livo-voice";

// 메모리 CacheStorage. 실제 Cache처럼 match마다 새 Response를 돌려준다(본문은 한 번만 읽을 수 있다)
function createMemoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    async open(name: string) {
      let entries = stores.get(name);
      if (!entries) stores.set(name, (entries = new Map()));
      const store = entries;
      return {
        async match(key: string) {
          return store.get(key)?.clone();
        },
        async put(key: string, res: Response) {
          store.set(key, res);
        },
        async delete(key: string) {
          return store.delete(key);
        },
      };
    },
  } as unknown as CacheStorage;
  const keys = () => [...(stores.get(CACHE_NAME)?.keys() ?? [])];
  const remove = (key: string) => stores.get(CACHE_NAME)?.delete(key);
  return { caches, keys, remove };
}

// 서명 URL은 받을 때마다 바뀐다. 오디오 내용은 '{version}/{phraseId}'
let signature = 0;
function bundleOf(version: string): VoiceBundle {
  signature += 1;
  return {
    version,
    source: "preset",
    items: ALL.map((id) => ({ phraseId: id, url: `https://audio.test/${version}/${id}?sig=${signature}` })),
    expiresAt: "2026-09-19T16:00:00.000Z",
  };
}

function createFakeFetch(failing: Set<string> = new Set()) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const content = new URL(String(input)).pathname.slice(1);
    if (failing.has(content)) return new Response(null, { status: 500 });
    return new Response(new Blob([content], { type: "audio/mpeg" }));
  });
}

// 재생 기록용. hold면 stop()이 불릴 때까지 재생이 끝나지 않는다
function createFakeOutput({ hold = false } = {}) {
  const plays: { audio: Blob; stopped: boolean }[] = [];
  let playing: { entry: (typeof plays)[number]; end: () => void } | null = null;
  const output: AudioOutput = {
    play(audio) {
      const entry = { audio, stopped: false };
      plays.push(entry);
      if (!hold) return Promise.resolve();
      return new Promise<void>((resolve) => {
        playing = { entry, end: resolve };
      });
    },
    stop() {
      if (!playing) return;
      playing.entry.stopped = true;
      playing.end();
      playing = null;
    },
  };
  return { output, plays };
}

async function setup(options: { caches?: CacheStorage; version?: string; failing?: Set<string>; hold?: boolean } = {}) {
  const memory = createMemoryCaches();
  const cache = options.caches ?? memory.caches;
  const fetchBundle = vi.fn(async () => bundleOf(options.version ?? "preset:male-50s"));
  const fetch = createFakeFetch(options.failing);
  const { output, plays } = createFakeOutput({ hold: options.hold });
  const player = await createVoicePlayer({ fetchBundle, fetch, cache, output });
  return { player, fetchBundle, fetch, plays, cache, ...memory };
}

const played = (plays: { audio: Blob }[]) => Promise.all(plays.map((p) => p.audio.text()));

describe("createVoicePlayer", () => {
  it("빈 저장소: 네트워크 호출 없이 만들어지고, 모든 문장이 준비 안 됨", async () => {
    const { player, fetchBundle, fetch, plays } = await setup();

    expect(fetchBundle).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    for (const id of ALL) expect(player.isReady(id)).toBe(false);
    await expect(player.speak("pain")).rejects.toBeInstanceOf(VoiceNotReadyError);
    expect(plays).toHaveLength(0);
  });

  it("sync 후 전부 준비되고, speak는 그 문장의 오디오를 재생한다", async () => {
    const { player, plays } = await setup();

    await player.sync();

    for (const id of ALL) expect(player.isReady(id)).toBe(true);
    await player.speak("pain");
    expect(await played(plays)).toEqual(["preset:male-50s/pain"]);
  });

  it("speak는 fetch·fetchBundle을 호출하지 않는다", async () => {
    const { player, fetchBundle, fetch } = await setup();
    await player.sync();
    const bundleCalls = fetchBundle.mock.calls.length;
    const fetchCalls = fetch.mock.calls.length;

    for (const id of ALL) await player.speak(id);

    expect(fetchBundle.mock.calls.length).toBe(bundleCalls);
    expect(fetch.mock.calls.length).toBe(fetchCalls);
  });

  it("같은 cache로 새 player를 만들면 네트워크 없이 준비된다 (오프라인 재시작)", async () => {
    const first = await setup();
    await first.player.sync();

    const second = await setup({ caches: first.cache });

    for (const id of ALL) expect(second.player.isReady(id)).toBe(true);
    await second.player.speak("water");
    expect(await played(second.plays)).toEqual(["preset:male-50s/water"]);
    expect(second.fetchBundle).not.toHaveBeenCalled();
    expect(second.fetch).not.toHaveBeenCalled();
  });

  it("같은 버전으로 다시 sync하면 오디오를 내려받지 않는다", async () => {
    const { player, fetchBundle, fetch } = await setup();
    await player.sync();
    expect(fetch).toHaveBeenCalledTimes(ALL.length);

    await player.sync();

    expect(fetchBundle).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(ALL.length);
  });

  it("같은 버전이라도 빠진 문장이 있으면 다시 내려받는다", async () => {
    const first = await setup();
    await first.player.sync();
    first.remove("/livo-voice/preset:male-50s/water");

    const second = await setup({ caches: first.cache });
    expect(second.player.isReady("water")).toBe(false);
    await second.player.sync();

    expect(second.fetch).toHaveBeenCalled();
    expect(second.player.isReady("water")).toBe(true);
  });
});

describe("목소리 교체", () => {
  it("v2 다운로드가 하나라도 실패하면 throw하고 v1으로 계속 재생한다", async () => {
    const failing = new Set<string>();
    const { player, fetchBundle, plays, cache } = await setup({ version: "v1", failing });
    await player.sync();

    fetchBundle.mockImplementation(async () => bundleOf("v2"));
    failing.add("v2/water");
    await expect(player.sync()).rejects.toThrow();

    for (const id of ALL) expect(player.isReady(id)).toBe(true);
    await player.speak("pain");
    expect(await played(plays)).toEqual(["v1/pain"]);
    // 단말 저장소도 v1 그대로
    const restarted = await setup({ caches: cache });
    await restarted.player.speak("pain");
    expect(await played(restarted.plays)).toEqual(["v1/pain"]);
  });

  it("이어서 v2 sync가 성공하면 v2로 재생하고 v1 키를 지운다", async () => {
    const failing = new Set<string>();
    const { player, fetchBundle, plays, keys } = await setup({ version: "v1", failing });
    await player.sync();
    fetchBundle.mockImplementation(async () => bundleOf("v2"));
    failing.add("v2/water");
    await expect(player.sync()).rejects.toThrow();

    failing.clear();
    await player.sync();

    await player.speak("pain");
    expect(await played(plays)).toEqual(["v2/pain"]);
    expect(keys().filter((k) => k.startsWith("/livo-voice/v1/"))).toEqual([]);
    expect(keys().sort()).toEqual(["/livo-voice/active", ...ALL.map((id) => `/livo-voice/v2/${id}`)].sort());
  });
});

describe("speak", () => {
  it("재생 중에 새 speak가 오면 이전 재생을 멈추고 새것을 재생한다", async () => {
    const { player, plays } = await setup({ hold: true });
    await player.sync();

    const first = player.speak("pain");
    void player.speak("water");

    await first; // 멈춘 재생은 끝난 것으로 처리된다
    expect(plays.map((p) => p.stopped)).toEqual([true, false]);
    expect(await played(plays)).toEqual(["preset:male-50s/pain", "preset:male-50s/water"]);
  });
});

// 브라우저 자동재생 정책: 사용자 조작 없이 새로 만든 오디오는 소리가 막힌다(특히 iOS).
// 요소 하나를 재사용하고, 보호자의 한 번의 터치로 그 요소의 재생 권한을 얻어 둔다.
function createFakeElement({ blocked = false } = {}) {
  const sources: string[] = []; // play() 때의 src
  const element = {
    src: "",
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    play: vi.fn(async () => {
      sources.push(element.src);
      if (blocked) throw new DOMException("자동재생 차단", "NotAllowedError");
    }),
    pause: vi.fn(),
  };
  let n = 0;
  const revoked: string[] = [];
  const urls = { create: () => `blob:${++n}`, revoke: (url: string) => void revoked.push(url) };
  return { element, sources, revoked, urls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const clip = () => new Blob(["x"], { type: "audio/mpeg" });

describe("오디오 출력 (자동재생 정책)", () => {
  it("문장마다 같은 오디오 요소로 재생하고, 끝나면 object URL을 해제한다", async () => {
    const { element, sources, revoked, urls } = createFakeElement();
    const output = createAudioElementOutput(element, urls);

    const first = output.play(clip());
    element.onended?.();
    await first;
    const second = output.play(clip());
    element.onended?.();
    await second;

    expect(sources).toEqual(["blob:1", "blob:2"]);
    expect(revoked).toEqual(["blob:1", "blob:2"]);
  });

  it("stop은 재생을 멈추고 대기 중인 play를 끝낸다", async () => {
    const { element, revoked, urls } = createFakeElement();
    const output = createAudioElementOutput(element, urls);

    const playing = output.play(clip());
    output.stop();

    await expect(playing).resolves.toBeUndefined();
    expect(element.pause).toHaveBeenCalled();
    expect(revoked).toEqual(["blob:1"]);
  });

  it("재생이 막히면 play가 reject하고 object URL을 해제한다", async () => {
    const { element, revoked, urls } = createFakeElement({ blocked: true });
    const output = createAudioElementOutput(element, urls);

    await expect(output.play(clip())).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(revoked).toEqual(["blob:1"]);
  });

  it("unlock은 무음 오디오를 같은 요소로 재생해 재생 권한을 얻는다", async () => {
    const { element, sources, urls } = createFakeElement();
    const output = createAudioElementOutput(element, urls);

    await output.unlock();

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/^data:audio\/wav;base64,/);
    expect(element.pause).toHaveBeenCalled();
  });

  it("발화 중에는 unlock이 재생을 끊지 않는다", async () => {
    const { element, sources, urls } = createFakeElement();
    const output = createAudioElementOutput(element, urls);

    void output.play(clip());
    await output.unlock();

    expect(sources).toEqual(["blob:1"]);
    expect(element.pause).not.toHaveBeenCalled();
  });

  it("화면 첫 터치에 unlock하고, 성공하면 더는 듣지 않는다", async () => {
    const { element, sources, urls } = createFakeElement();
    const target = new EventTarget();
    unlockOnFirstGesture(createAudioElementOutput(element, urls), target);

    target.dispatchEvent(new Event("pointerdown"));
    await flush();
    target.dispatchEvent(new Event("keydown"));
    await flush();

    expect(sources).toHaveLength(1);
  });

  it("unlock이 막히면 다음 터치에 다시 시도한다", async () => {
    const { element, sources, urls } = createFakeElement({ blocked: true });
    const target = new EventTarget();
    unlockOnFirstGesture(createAudioElementOutput(element, urls), target);

    target.dispatchEvent(new Event("pointerdown"));
    await flush();
    target.dispatchEvent(new Event("pointerdown"));
    await flush();

    expect(sources).toHaveLength(2);
  });
});
