import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioExtensionForMime,
  buildVoiceFileName,
  formatRecordingDuration,
  isVoiceAttachment,
  pickSupportedAudioMimeType,
} from './voice';

test('pickSupportedAudioMimeType picks highest-priority supported codec', () => {
  const mime = pickSupportedAudioMimeType(
    (m) => m === 'audio/webm' || m === 'audio/ogg'
  );
  assert.equal(mime, 'audio/webm');
  assert.equal(pickSupportedAudioMimeType(() => false), '');
  assert.equal(pickSupportedAudioMimeType(undefined), '');
});

test('audioExtensionForMime maps common MediaRecorder mime types', () => {
  assert.equal(audioExtensionForMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(audioExtensionForMime('audio/mp4'), 'm4a');
  assert.equal(audioExtensionForMime('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(audioExtensionForMime('audio/wav'), 'wav');
});

test('formatRecordingDuration and buildVoiceFileName produce deterministic metadata', () => {
  assert.equal(formatRecordingDuration(0), '0:00');
  assert.equal(formatRecordingDuration(9), '0:09');
  assert.equal(formatRecordingDuration(74.8), '1:14');

  assert.equal(
    buildVoiceFileName(12, 'audio/webm;codecs=opus', 1700000000000),
    'voice-00m12s-1700000000000.webm'
  );
});

test('isVoiceAttachment detects audio mime types and voice filenames', () => {
  assert.equal(isVoiceAttachment({ mimeType: 'audio/webm;codecs=opus' }), true);
  assert.equal(
    isVoiceAttachment({
      mimeType: 'application/octet-stream',
      fileName: 'voice-00m05s-1700000000000.webm',
    }),
    true
  );
  assert.equal(
    isVoiceAttachment({ mimeType: 'application/pdf', fileName: 'report.pdf' }),
    false
  );
});
