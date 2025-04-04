// public/audio-processor.worklet.js
class PCMEncoderProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
    }
  
    process(inputs) {
      const input = inputs[0];
      if (input.length > 0) {
        const channel = input[0];
        const buffer = new ArrayBuffer(channel.length * 2);
        const view = new DataView(buffer);
  
        for (let i = 0; i < channel.length; i++) {
          let s = Math.max(-1, Math.min(1, channel[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
  
        this.port.postMessage(buffer);
      }
      return true;
    }
  }
  
  registerProcessor('pcm-encoder-processor', PCMEncoderProcessor);
  