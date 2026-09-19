// 대상자 카메라. 프레임은 이 기기 안에서만 쓴다 — 저장·전송하지 않는다 (CLAUDE.md CRITICAL).

export interface CameraHandle {
  stream: MediaStream;
  /** 트랙을 모두 끄고, video.srcObject가 이 스트림이면 비운다. 여러 번 불러도 된다. */
  stop(): void;
}

/** 전면 카메라를 켜 video에 붙이고 재생한다. 소리는 받지 않는다. */
export async function openCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  let stopped = false;
  const handle: CameraHandle = {
    stream,
    stop() {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    // 재생을 못 하면 켠 카메라를 남겨 두지 않는다
    handle.stop();
    throw error;
  }
  return handle;
}
