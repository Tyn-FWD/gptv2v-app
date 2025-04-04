// src/app/realtime-ws/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export default function RealtimeWebSocketPage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState("Idle");
  const [isActive, setIsActive] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const currentAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    const endpoint = process.env.NEXT_PUBLIC_AZURE_OPENAI_WS_ENDPOINT!;
    const wsUrl = `${endpoint}&api-key=${process.env.NEXT_PUBLIC_AZURE_OPENAI_API_KEY}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    let audioContext: AudioContext;
    let workletNode: AudioWorkletNode;
    let source: MediaStreamAudioSourceNode;
    let audioChunks: Uint8Array[] = [];

    function encodeToBase64(buffer: ArrayBuffer): string {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    function decodeBase64ToUint8Array(base64: string): Uint8Array {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }

    function createWavFile(pcmData: Uint8Array, sampleRate = 24000, numChannels = 1): Uint8Array {
      const byteRate = sampleRate * numChannels * 2;
      const blockAlign = numChannels * 2;
      const wavHeader = new ArrayBuffer(44);
      const view = new DataView(wavHeader);

      const writeString = (view: DataView, offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeString(view, 0, "RIFF");
      view.setUint32(4, 36 + pcmData.length, true);
      writeString(view, 8, "WAVE");
      writeString(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, "data");
      view.setUint32(40, pcmData.length, true);

      const wavData = new Uint8Array(44 + pcmData.length);
      wavData.set(new Uint8Array(wavHeader), 0);
      wavData.set(pcmData, 44);

      return wavData;
    }

    ws.onopen = async () => {
      console.log("WebSocket connection established");
      setStatus("Connected - Initializing Audio");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext({ sampleRate: 16000 });
      await audioContext.audioWorklet.addModule("/audio-processor.worklet.js");

      source = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioContext, "pcm-encoder-processor");

      workletNode.port.onmessage = (event) => {
        const buffer: ArrayBuffer = event.data;
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = encodeToBase64(buffer);
          ws.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: base64
          }));
        }
      };

      source.connect(workletNode).connect(audioContext.destination);

      ws.send(JSON.stringify({
        type: "session.update",
        session: {
            instructions: "You are Rico, an insurance Customer from the Phillipines. You are very angry and impatient.",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            voice: "ash"
        }
      }));


      setStatus("Streaming audio to Azure...");

      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        }
      }, 5000);
    };

    ws.onmessage = (e) => {
      try {
        const serverEvent = JSON.parse(e.data);

        if (serverEvent.type === "response.audio.delta" && serverEvent.delta) {
          const chunk = decodeBase64ToUint8Array(serverEvent.delta);
          audioChunks.push(chunk);
        } else if (serverEvent.type === "response.audio.done") {
          const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const allChunks = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            allChunks.set(chunk, offset);
            offset += chunk.length;
          }
          audioChunks = []; // clear buffer

          const wavData = createWavFile(allChunks, 24000);
          const blob = new Blob([wavData], { type: "audio/wav" });
          const audioUrl = URL.createObjectURL(blob);

          if (currentAudio.current) {
            currentAudio.current.pause();
            currentAudio.current.currentTime = 0;
          }

          const audio = new Audio(audioUrl);
          currentAudio.current = audio;
          audio.play().catch(err => console.warn("Audio playback error:", err));
        } else if (serverEvent.type === "response.audio_transcript.done") {
          if (serverEvent.transcript) {
            setTranscript(prev => [...prev, serverEvent.transcript]);
          }
        } else if (serverEvent.type === "error") {
          console.error("Azure Realtime Error:", serverEvent.error.message);
          if (serverEvent.error.param) {
            console.error("Missing or invalid parameter:", serverEvent.error.param);
          }
        } else if (serverEvent.type !== "response.audio_transcript.delta") {
          console.log("Event from model:", serverEvent);
        }
      } catch (err) {
        console.warn("Non-JSON message or parse error:", e.data);
      }
    };

    ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      setStatus("WebSocket error");
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      setStatus("Disconnected");
    };

    return () => {
      ws.close();
      if (source) source.disconnect();
      if (workletNode) workletNode.disconnect();
      if (audioContext) audioContext.close();
      setStatus("Idle");
    };
  }, [isActive]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">🎤 Azure Realtime Voice Chat</h1>
      <p className="text-sm text-gray-600">Status: {status}</p>
      <div className="space-x-2">
        <button
          className="bg-green-600 text-white px-4 py-2 rounded"
          onClick={() => setIsActive(true)}
          disabled={isActive}
        >
          Start Chat
        </button>
        <button
          className="bg-red-500 text-white px-4 py-2 rounded"
          onClick={() => setIsActive(false)}
          disabled={!isActive}
        >
          Stop Chat
        </button>
      </div>
      <audio ref={audioRef} autoPlay hidden />

      {transcript.length > 0 && (
        <div className="mt-6 space-y-2">
          <h2 className="text-md font-semibold">📝 Transcript</h2>
          <div className="bg-white text-black p-4 rounded-lg text-sm whitespace-pre-line">
            {transcript.map((line, i) => (
              <p key={i}>Rico: {line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}