/** Wraps 16-bit mono PCM chunks in a WAV container. */
export function encodeWav(chunks, sampleRate) {
  const sampleCount = chunks.reduce((n, c) => n + c.length, 0);
  const dataBytes = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) bytes[offset + i] = str.charCodeAt(i);
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(offset, chunk[i], true);
      offset += 2;
    }
  }
  return bytes;
}
