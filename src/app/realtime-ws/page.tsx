// src/app/realtime-ws/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function RealtimeWebSocketPage() {
  const [status, setStatus] = useState("Idle");
  const [isActive, setIsActive] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [bufferThreshold, setBufferThreshold] = useState(9600);
  const segmentBuffer = useRef<Uint8Array[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextAudioTime = useRef(0);
  const searchParams = useSearchParams();
  const promptName = searchParams.get("prompt") || "instructions";
  const promptUrl = `/prompts/${promptName}.txt`;


  useEffect(() => {
    if (!isActive) return;

    const startRealtimeChat = async () => {
      const endpoint = process.env.NEXT_PUBLIC_AZURE_OPENAI_WS_ENDPOINT!;
      const wsUrl = `${endpoint}&api-key=${process.env.NEXT_PUBLIC_AZURE_OPENAI_API_KEY}`;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      let audioContext: AudioContext;
      let workletNode: AudioWorkletNode;
      let source: MediaStreamAudioSourceNode;

      const instructionsText = await fetch(promptUrl).then(res => res.text());
      console.log("Prompt:",instructionsText)
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

      function scheduleAudioPlayback(wavBytes: Uint8Array) {
        const blob = new Blob([wavBytes], { type: "audio/wav" });
        const fileReader = new FileReader();
        fileReader.onloadend = () => {
          const arrayBuffer = fileReader.result as ArrayBuffer;
          if (!audioContextRef.current) return;
          audioContextRef.current.decodeAudioData(arrayBuffer, (audioBuffer) => {
            const source = audioContextRef.current!.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current!.destination);

            const startTime = Math.max(audioContextRef.current!.currentTime, nextAudioTime.current);
            source.start(startTime);
            nextAudioTime.current = startTime + audioBuffer.duration;
          });
        };
        fileReader.readAsArrayBuffer(blob);
      }

      ws.onopen = async () => {
        console.log("WebSocket connection established");
        setStatus("Connected - Initializing Audio");

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
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
            instructions: instructionsText,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            voice: "ash",
            input_audio_transcription: {
              model: "whisper-1"
            }
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
            segmentBuffer.current.push(chunk);

            const bufferedLength = segmentBuffer.current.reduce((acc, c) => acc + c.length, 0);
            if (bufferedLength >= bufferThreshold) {
              const segment = new Uint8Array(bufferedLength);
              let offset = 0;
              for (const c of segmentBuffer.current) {
                segment.set(c, offset);
                offset += c.length;
              }
              segmentBuffer.current = [];

              const wavData = createWavFile(segment, 24000);
              scheduleAudioPlayback(wavData);
            }
          } else if (serverEvent.type === "response.audio.done") {
            if (segmentBuffer.current.length > 0) {
              const bufferedLength = segmentBuffer.current.reduce((acc, c) => acc + c.length, 0);
              const segment = new Uint8Array(bufferedLength);
              let offset = 0;
              for (const c of segmentBuffer.current) {
                segment.set(c, offset);
                offset += c.length;
              }
              segmentBuffer.current = [];

              const wavData = createWavFile(segment, 24000);
              scheduleAudioPlayback(wavData);
            }
          } else if (serverEvent.type === "response.audio_transcript.done") {
            if (serverEvent.transcript) {
              setTranscript(prev => [...prev, `Rico: ${serverEvent.transcript}`]);
            }
          } else if (serverEvent.type === "conversation.item.input_audio_transcription.completed") {
            if (serverEvent.transcript) {
              setTranscript(prev => [...prev, `Agent: ${serverEvent.transcript}`]);
            }
          } else if (serverEvent.type === "error") {
            console.error("Azure Realtime Error:", serverEvent.error.message);
            if (serverEvent.error.param) {
              console.error("Missing or invalid parameter:", serverEvent.error.param);
            }
          } else if (serverEvent.type !== "response.audio_transcript.delta") {
            console.log("Event from model:", serverEvent);
          }
        } catch {
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
    };

    startRealtimeChat();

    return () => {
      setStatus("Idle");
    };
  }, [isActive, bufferThreshold]);

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

      <div className="pt-4">
        <label htmlFor="buffer" className="block text-sm font-medium text-gray-700">
          Buffer Threshold (ms): {(bufferThreshold / 48000 * 1000).toFixed(0)}ms
        </label>
        <input
          id="buffer"
          type="range"
          min="4800"
          max="19200"
          step="1200"
          value={bufferThreshold}
          onChange={(e) => setBufferThreshold(parseInt(e.target.value))}
          className="w-full"
        />
      </div>

      {transcript.length > 0 && (
        <div className="mt-6 space-y-2">
          <h2 className="text-md font-semibold">📝 Transcript</h2>
          <div className="bg-white text-black p-4 rounded-lg text-sm whitespace-pre-line">
            {transcript.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
