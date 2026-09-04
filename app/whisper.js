/* Browser decoding + local PCM conversion, no remote requests or FFmpeg. */
(() => {
  'use strict';
  function encodeWAV(samples) {
    const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
    const label = (offset, text) => [...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
    label(0,'RIFF'); view.setUint32(4,bytes.byteLength-8,true); label(8,'WAVEfmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    label(36,'data'); view.setUint32(40,samples.length*2,true);
    samples.forEach((sample,index)=>{ const value=Math.max(-1,Math.min(1,sample)); view.setInt16(44+index*2,value<0?value*32768:value*32767,true); });
    return new Blob([bytes],{type:'audio/wav'});
  }
  async function convert(blob) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !window.OfflineAudioContext) throw new Error('当前浏览器无法解码录音，请使用新版 Edge 或 Chrome');
    const context = new Audio();
    let decoded;
    try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); } finally { await context.close(); }
    if (!decoded.duration || decoded.duration>480) throw new Error('本地转写支持最多 8 分钟录音，请分段练习');
    const offline = new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
    const source = offline.createBufferSource(); source.buffer=decoded; source.connect(offline.destination); source.start();
    const output = await offline.startRendering();
    return encodeWAV(output.getChannelData(0));
  }
  window.localWhisper = {
    encodeWAV,
    async status() { const response=await fetch('/api/transcription/status'); if(!response.ok) return {ready:false}; return response.json(); },
    async transcribe(blob, signal) {
      const wav = await convert(blob);
      if(signal?.aborted) throw new DOMException('已取消','AbortError');
      const response=await fetch('/api/transcription',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav,signal});
      const result=await response.json();
      if(!response.ok || !result.text) throw new Error(result.error || '本地转写失败');
      return result.text;
    }
  };
})();
