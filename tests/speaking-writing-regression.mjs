import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
const timers = new Set();
function harness(initialState, localWhisper) {
  localWhisper ||= { status: async () => ({ready:true}), transcribe: async () => 'Local Whisper result.' };
  const elements = new Map();
  let persisted;
  let failWrites = false;
  const chatRequests = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', innerHTML: '', src: '', disabled: false,
      dataset: {}, events: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, fn) { this.events[name] = fn; },
      querySelectorAll() { return []; }, pause() {}, load() {}, focus() {},
      removeAttribute(name) { this[name] = ''; },
    });
    return elements.get(selector);
  };
  class Reader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload?.();
    }
  }
  class Recorder {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['test-audio-payload'], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  let recognitionStarts = 0;
  class Recognition {
    start() {
      recognitionStarts++;
      const result = [{ transcript: 'last sentence pending' }];
      result.isFinal = false;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
    stop() {
      queueMicrotask(() => {
        const result = [{ transcript: 'This is the final sentence.' }];
        result.isFinal = true;
        this.onresult?.({ resultIndex: 0, results: [result] });
        this.onend?.();
      });
    }
    abort() {}
  }
  const context = vm.createContext({
    Blob, Uint8Array, atob, structuredClone, AbortController, FileReader: Reader,
    MediaRecorder: Recorder, URL: { createObjectURL: () => 'blob:test-audio', revokeObjectURL() {} },
    window: { localWhisper, SpeechRecognition: Recognition, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    document: { querySelector: element, querySelectorAll: () => [] },
    location: { hash: '#unit-test' }, confirm: () => true,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout,
    setInterval(fn, ms) { const timer = setInterval(fn, ms); timers.add(timer); return timer; }, clearInterval,
    fetch: async (url, options) => {
      if (url === '/api/ai/chat') {
        chatRequests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ content: 'Synthetic feedback' }) };
      }
      if (url === '/api/data' && options?.method === 'PUT') {
        if (failWrites) return { ok: false, json: async () => ({ error: 'test disk failure' }) };
        persisted = JSON.parse(options.body).data;
      }
      return { ok: true, json: async () => ({ storage: { bound: true, directory: 'test-data' } }) };
    }
  });
  vm.runInContext(source.replace(/  initialize\(\);\s*\}\)\(\);\s*$/, `
    globalThis.api = { refreshTranscriptionStatus, transcribeLocalRecording, bindEvents, toggleRecording, saveWriting, saveSpeaking, loadSpeaking, newSpeaking, loadWriting, todayPlanTasks, normalizePlanDay, normalizeAiPlanDay, reviewWriting, reviewSpeaking, reviewLearnerContext, reviewTopicTitle, practiceTitle,
      enableAi() { aiConnected = true; },
      get busy() { return recordingBusy; }, get blob() { return recordingBlob; },
      get state() { return state; }, set state(value) { state = normalizeState(value); }
    };
  })();`), context);
  if (initialState) context.api.state = initialState;
  element('#speakingPart').value = 'p1';
  element('#speechLanguage').value = 'en-GB';
  context.api.bindEvents();
  return { api: context.api, element, context, chatRequests, persisted: () => persisted,
    recognitionStarts: () => recognitionStarts, failWrites: () => { failWrites = true; } };
}

try {
  let completeTranscription;
  const offline = harness(undefined, {status: async () => ({ready:true}), transcribe: () => new Promise(resolve => {completeTranscription = resolve;})});
  await offline.api.refreshTranscriptionStatus();
  assert.match(offline.element('#transcriptionStatus').textContent, /自动在本机转写/);
  await offline.api.toggleRecording();
  assert.equal(offline.recognitionStarts(), 0, 'offline capture must not invoke browser speech services');
  await offline.api.toggleRecording();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(offline.api.busy, true);
  assert.equal(offline.element('#speakingTranscript').disabled, true);
  completeTranscription('Offline result.');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(offline.api.busy, false);
  assert.equal(offline.element('#speakingTranscript').value, 'Offline result.');
  assert.equal(await offline.api.saveSpeaking(), true);
  assert.equal(offline.persisted().speaking[0].transcript, 'Offline result.');
  assert.match(offline.persisted().speaking[0].audio, /^data:audio/);
  const pending = offline.api.transcribeLocalRecording();
  await offline.api.newSpeaking();
  completeTranscription('Late obsolete result');
  await pending;
  assert.equal(offline.element('#speakingTranscript').value, '', 'late transcription must not overwrite a new practice');

  const h = harness();
  assert.equal(h.api.reviewTopicTitle('- **主题**: 儿童成长环境的选择，属于社会与教育类话题。'), '儿童成长环境的选择');
  assert.equal(h.api.reviewTopicTitle('主题：城市与乡村的儿童成长'), '城市与乡村的儿童成长');
  assert.equal(h.api.practiceTitle({type:'Task 2', prompt:'A specific question'}), 'A specific question');
  assert.equal(h.api.practiceTitle({type:'Task 2', review:'- **主题**: 儿童成长环境的选择，属于社会与教育类话题。'}), '儿童成长环境的选择');
  assert.equal('listening' in h.api.state, false, 'fresh state must not create retired libraries');
  assert.equal('reading' in h.api.state, false);
  assert.deepEqual(Object.keys(h.api.normalizePlanDay({ listening: 9, reading: 9, writing: 5, speaking: 10 })), ['writing', 'speaking', 'writingReview', 'writingRewrite', 'speakingReview', 'languageMinutes', 'reviewMinutes', 'note']);
  assert.equal(h.api.normalizePlanDay({writing:5}).writing, 1, 'new writing volume must be capped');
  assert.equal(h.api.normalizePlanDay({speaking:10}).speaking, 2, 'new speaking volume must be capped');
  assert.equal(JSON.stringify(h.api.normalizeAiPlanDay({writing:1,speaking:1})), JSON.stringify({writing:1,speaking:1,writingReview:1,writingRewrite:1,speakingReview:1,languageMinutes:10,reviewMinutes:0,note:''}), 'AI output must be expanded into a review-first loop');
  h.api.state = { listening: [{ id: 'keep-legacy' }], reading: [{ id: 'keep-old' }], writings: [], speaking: [] };
  await h.api.refreshTranscriptionStatus();
  await h.api.toggleRecording();
  assert.equal(h.recognitionStarts(), 0, 'browser speech recognition must never start');
  assert.match(h.element('#speakingSaveStatus').textContent, /结束转写后自动保存/);
  await h.api.toggleRecording();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.api.busy, false);
  assert.equal(h.element('#speakingTranscript').value, 'Local Whisper result.');
  assert.equal(await h.api.saveSpeaking(), true);
  const saved = h.persisted().speaking[0];
  assert.equal(h.persisted().listening[0].id, 'keep-legacy', 'normal saves must preserve opaque old data');
  assert.equal(h.persisted().reading[0].id, 'keep-old');
  assert.match(saved.audio, /^data:audio\/webm;codecs=opus;base64,/);
  assert.equal(saved.transcript, 'Local Whisper result.');

  const reloaded = harness(h.persisted());
  await reloaded.api.loadSpeaking(saved.id);
  assert.equal(await reloaded.api.blob.text(), 'test-audio-payload', 'history must restore the audio bytes');
  assert.equal(reloaded.element('#speakingTranscript').value, saved.transcript);
  assert.equal(await reloaded.api.saveSpeaking(), true, 'resaving history must retain its audio');
  assert.equal(reloaded.persisted().speaking[0].audio, saved.audio);
  reloaded.failWrites();
  assert.equal(await reloaded.api.saveSpeaking(), false, 'disk failure must not report success');

  const legacy = harness({ speaking: [{ id: 'legacy', transcript: 'Old text', prompt: '', duration: 2 }] });
  await legacy.api.loadSpeaking('legacy');
  assert.equal(legacy.api.blob, null);
  assert.equal(legacy.element('#speakingTranscript').value, 'Old text');

  for (const [type, minutes] of [['Task 1 Academic', '20'], ['Task 1 General', '20'], ['Task 2', '40']]) {
    h.element('#writingType').value = type;
    h.element('#writingType').events.change();
    assert.equal(h.element('#writingMinutes').value, minutes);
    assert.equal(h.element('#writingTimer').textContent, `${minutes}:00`);
  }
  h.element('#writingType').value = '自由写作';
  h.element('#writingType').events.change();
  assert.equal(h.element('#writingMinutes').value, '0');
  assert.equal(h.element('#writingTimer').textContent, '00:00');
  assert.equal(h.element('#toggleTimer').textContent, '开始正计时');
  h.api.state.writings.push({ id: 'custom', type: 'Task 1 Academic', minutes: 60, prompt: 'Saved', essay: '', updatedAt: new Date().toISOString() });
  await h.api.loadWriting('custom');
  assert.equal(h.element('#writingMinutes').value, '60', 'history must preserve the saved duration');
  h.api.state.studyPlan = { profile: { currentLevel: '写作 5.5，口语 6.0', targetLevel: '写作 7.0，口语 7.5', focus: '论证与自然表达' } };
  h.api.enableAi();
  h.element('#writingEssay').value = 'A short practice essay.';
  await h.api.reviewWriting();
  await h.api.reviewSpeaking();
  assert.equal(h.chatRequests.length, 2);
  for (const request of h.chatRequests) {
    assert.match(request.messages[1].content, /现有水平（用户自述）：写作 5.5，口语 6.0/);
    assert.match(request.messages[1].content, /目标水平（用户设定）：写作 7.0，口语 7.5/);
    assert.match(request.messages[1].content, /论证与自然表达/);
    assert.doesNotMatch(request.messages[0].content, /6.0–6.5/);
    assert.doesNotMatch(request.messages[0].content, /批改原则补充|写作修订规则|口语修订规则/);
  }
  assert.match(h.chatRequests[0].messages[0].content, /只有客观、明确/);
  assert.match(h.chatRequests[0].messages[0].content, /可选优化建议/);
  assert.match(h.chatRequests[1].messages[0].content, /本地 Whisper/);
  h.api.state.studyPlan = null;
  assert.match(h.api.reviewLearnerContext('写作'), /现有水平（用户自述）：未提供/);
  assert.match(h.api.reviewLearnerContext('写作'), /目标水平（用户设定）：未提供/);
  const autosave = harness();
  autosave.element('#writingEssay').value = 'Autosaved writing draft.';
  autosave.element('#writingEssay').events.input();
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(autosave.persisted().writings[0].essay, 'Autosaved writing draft.');
  autosave.element('#speakingTranscript').value = 'Autosaved speaking draft.';
  autosave.element('#speakingTranscript').events.input();
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(autosave.persisted().speaking[0].transcript, 'Autosaved speaking draft.');
  console.log('Speaking capture/transcript/disk persistence/reload/failure and writing timer regression tests passed.');
} finally {
  for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
}
