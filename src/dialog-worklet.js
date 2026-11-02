// AudioWorklet around dialog.js, which is loaded into the same worklet scope first.
// The slider value arrives through the port.
class DialogProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = globalThis.AVFXDialog.createProcessor(sampleRate);
    this.silence = new Float32Array(128);
    this.port.onmessage = (e) => this.dsp.setAmount(e.data);
  }

  process(inputs, outputs) {
    const [l = this.silence, r = l] = inputs[0];
    const [outL, outR = new Float32Array(outL.length)] = outputs[0];
    if (l.length !== this.silence.length) this.silence = new Float32Array(l.length);
    this.dsp.process(l, r, outL, outR);
    return true;
  }
}

registerProcessor("klangbild-dialog", DialogProcessor);
