// src/app/realtime/page.tsx
"use client";

import { useEffect } from "react";

export default function RealtimeVoicePage() {
  useEffect(() => {
    async function startChat() {

      const pc = new RTCPeerConnection();

      const audioElem = document.createElement("audio");
      audioElem.autoplay = true;
      document.body.appendChild(audioElem);

      pc.ontrack = (event) => {
        audioElem.srcObject = event.streams[0];
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micTrack = stream.getAudioTracks()[0];
        pc.addTrack(micTrack);
      } catch (err) {
        console.error("Microphone access error:", err);
        return;
      }

      const dataChannel = pc.createDataChannel("oai-events");
      dataChannel.onopen = () => {
        console.log("Data channel opened");
      };
      dataChannel.onmessage = (event) => {
        console.log("Model event:", event.data);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch("/api/realtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      const sdpAnswer = await response.text();
      if (!response.ok || !sdpAnswer.startsWith("v=")) {
        console.error("Invalid response from Azure Realtime:", sdpAnswer);
        return;
      }

      await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
      console.log("Realtime voice connection established.");
    }

    startChat();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-2">🎙️ Azure Realtime Voice Chat</h1>
      <p className="text-gray-600">Speak and get real-time responses from ChatGPT.</p>
    </div>
  );
}
