import { useEffect, useRef, useState } from "react";
import { registerCameraWebRtcSrs } from "@/api/config.js";

interface CameraRecord {
  id?: number | string;
  cameraId?: number | string;
  cameraIp?: string;
  rtspUrl?: string;
}

interface VideoPlayerProps {
  camera?: CameraRecord | null;
  visibleType: 1 | 2;
  backendReady: boolean;
  onDoubleClick?: () => void;
}

interface BackendResponse {
  code?: number;
  success?: boolean;
  message?: string | null;
  data?: any;
}

interface ZlmEndpoint {
  on: (event: string, handler: (payload?: any) => void) => void;
  close: () => void;
}

interface ZlmRtcClient {
  Endpoint: new (options: {
    element: HTMLVideoElement;
    debug?: boolean;
    zlmsdpUrl: string;
    simulecast: boolean;
    useCamera: boolean;
    audioEnable: boolean;
    videoEnable: boolean;
    recvOnly: boolean;
    usedatachannel: boolean;
  }) => ZlmEndpoint;
  Events?: Record<string, string>;
}

let zlmScriptPromise: Promise<void> | null = null;

function getZlmScriptUrl(): string {
  return new URL("static/js/ZLMRTCClient.js", document.baseURI).toString();
}

function ensureZlmRtcClient(): Promise<void> {
  if (window.ZLMRTCClient?.Endpoint) return Promise.resolve();
  if (zlmScriptPromise) return zlmScriptPromise;

  zlmScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-zlm-rtc-client="true"]',
    );
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("WebRTC 播放器加载失败")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = getZlmScriptUrl();
    script.dataset.zlmRtcClient = "true";
    script.onload = () => {
      if (window.ZLMRTCClient?.Endpoint) {
        resolve();
      } else {
        reject(new Error("WebRTC 播放器初始化失败"));
      }
    };
    script.onerror = () => reject(new Error("WebRTC 播放器加载失败"));
    document.head.appendChild(script);
  }).catch((error) => {
    zlmScriptPromise = null;
    throw error;
  });

  return zlmScriptPromise;
}

function getCameraId(camera?: CameraRecord | null): number | string | undefined {
  const value = camera?.cameraId ?? camera?.id;
  return value === null || value === undefined || value === "" ? undefined : value;
}

function resolveStreamUrl(data: any): string {
  const url = data?.rtcs || data?.rtc;
  return typeof url === "string" ? url.trim() : "";
}

function getResponseData(response: any): BackendResponse {
  return (response?.data || {}) as BackendResponse;
}

function isSuccessfulResponse(body: BackendResponse): boolean {
  return body.success === true || body.code === 200;
}

function getErrorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function RealtimeVideoPlayer({
  camera,
  visibleType,
  backendReady,
  onDoubleClick,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const endpointRef = useRef<ZlmEndpoint | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const cameraId = getCameraId(camera);

  useEffect(() => {
    let disposed = false;
    const video = videoRef.current;

    const handlePlaying = () => {
      if (!disposed) setStatus("playing");
    };
    const handleVideoError = () => {
      if (!disposed) {
        setStatus("error");
        setErrorText("视频播放失败");
      }
    };

    const closePlayer = () => {
      endpointRef.current?.close();
      endpointRef.current = null;
      if (video) {
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("error", handleVideoError);
        video.pause();
        video.srcObject = null;
        video.removeAttribute("src");
        video.load();
      }
    };

    closePlayer();
    setErrorText("");

    if (!backendReady) {
      setStatus("idle");
      return closePlayer;
    }
    if (!cameraId) {
      setStatus("idle");
      return closePlayer;
    }
    if (!video) {
      setStatus("error");
      setErrorText("视频容器初始化失败");
      return closePlayer;
    }

    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleVideoError);
    setStatus("loading");
    void (async () => {
      try {
        await ensureZlmRtcClient();
        if (disposed) return;

        const response = await registerCameraWebRtcSrs({
          cameraId,
          visibleType,
        });
        const body = getResponseData(response);
        if (!isSuccessfulResponse(body)) {
          throw new Error(body.message || "视频流注册失败");
        }

        const streamUrl = resolveStreamUrl(body.data);
        if (!streamUrl) {
          throw new Error("后台未返回视频流地址");
        }

        const client = window.ZLMRTCClient as ZlmRtcClient | undefined;
        if (!client?.Endpoint) {
          throw new Error("WebRTC 播放器不可用");
        }

        const endpoint = new client.Endpoint({
          element: video,
          debug: false,
          zlmsdpUrl: streamUrl,
          simulecast: false,
          useCamera: false,
          audioEnable: true,
          videoEnable: true,
          recvOnly: true,
          usedatachannel: false,
        });
        if (disposed) {
          endpoint.close();
          return;
        }

        endpointRef.current = endpoint;
        const events = client.Events || {};
        const remoteStreamEvent = events.WEBRTC_ON_REMOTE_STREAMS;
        const connectionStateEvent = events.WEBRTC_ON_CONNECTION_STATE_CHANGE;
        const offerAnswerErrorEvent = events.WEBRTC_OFFER_ANWSER_EXCHANGE_FAILED;

        if (remoteStreamEvent) {
          endpoint.on(remoteStreamEvent, () => {
            if (!disposed) setStatus("playing");
          });
        }
        if (connectionStateEvent) {
          endpoint.on(connectionStateEvent, (state) => {
            if (disposed) return;
            if (state === "connected") setStatus("playing");
            if (state === "failed") {
              setStatus("error");
              setErrorText("视频流连接失败");
            }
          });
        }
        if (offerAnswerErrorEvent) {
          endpoint.on(offerAnswerErrorEvent, () => {
            if (!disposed) {
              setStatus("error");
              setErrorText("视频流协商失败");
            }
          });
        }
      } catch (error) {
        if (!disposed) {
          setStatus("error");
          setErrorText(getErrorText(error, "视频播放失败"));
        }
      }
    })();

    return () => {
      disposed = true;
      closePlayer();
    };
  }, [backendReady, cameraId, visibleType]);

  const message = !backendReady
    ? "请先连接后台"
    : !cameraId
      ? "暂无视频数据"
      : status === "error"
        ? errorText || "视频播放失败"
        : status === "playing"
          ? ""
          : "正在连接视频...";

  return (
    <div className="realtime-monitor-video-player" onDoubleClick={onDoubleClick}>
      <video
        ref={videoRef}
        className="realtime-monitor-video-player__video"
        autoPlay
        muted
        playsInline
      />
      {message && (
        <div
          className={`realtime-monitor-video-player__message ${status === "error" ? "is-error" : ""}`}
          role={status === "error" ? "alert" : undefined}
        >
          {message}
        </div>
      )}
    </div>
  );
}
