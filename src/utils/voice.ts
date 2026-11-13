export const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

export function pickSupportedAudioMimeType(
  isTypeSupported?: (mimeType: string) => boolean
): string {
  if (!isTypeSupported) return '';
  for (const mime of PREFERRED_AUDIO_MIME_TYPES) {
    if (isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function audioExtensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  return 'webm';
}

export function formatRecordingDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function buildVoiceFileName(
  durationSec: number,
  mimeType: string,
  timestamp = Date.now()
): string {
  const clamped = Math.max(1, Math.round(durationSec));
  const mins = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const secs = (clamped % 60).toString().padStart(2, '0');
  const ext = audioExtensionForMime(mimeType);
  return `voice-${mins}m${secs}s-${timestamp}.${ext}`;
}

export function isVoiceAttachment(attachment?: {
  mimeType?: string;
  fileName?: string;
}): boolean {
  if (!attachment) return false;
  if (attachment.mimeType?.toLowerCase().startsWith('audio/')) return true;
  return Boolean(
    attachment.fileName && /^voice-\d{2}m\d{2}s-.*\.(webm|m4a|ogg|wav|mp3)$/i.test(attachment.fileName)
  );
}
