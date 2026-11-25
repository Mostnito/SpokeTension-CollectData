import { encodeMp3 } from './encode-mp3.js';

self.onmessage = ({ data }) => {
  try {
    const { bytes, sampleCount } = encodeMp3(data.chunks, data.sampleRate);
    self.postMessage({ bytes, sampleCount }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || 'audioEncodingFailed' });
  }
};
