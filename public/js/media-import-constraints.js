const BYTES_PER_MIB = 1024 * 1024;

export const MAX_REMOTE_IMPORT_BYTES = 4 * BYTES_PER_MIB;
export const MAX_LOCAL_TEXT_IMPORT_BYTES = 25 * BYTES_PER_MIB;
export const MAX_MEDIA_IMPORT_BYTES = MAX_REMOTE_IMPORT_BYTES;

const LOCAL_TEXT_KINDS = new Set(['txt', 'md', 'html', 'csv', 'json', 'rtf']);

export function formatBinaryMegabytes(bytes) {
  const mib = Number(bytes) / BYTES_PER_MIB;
  if (!Number.isFinite(mib) || mib <= 0) return '0 MiB';
  const rounded = mib >= 10 ? Math.round(mib) : Math.round(mib * 10) / 10;
  return `${rounded} MiB`;
}

export function validateMediaImportSize(file, { kind = '', maxBytes } = {}) {
  const size = Number(file && file.size);
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const effectiveMax = Number.isFinite(Number(maxBytes))
    ? Number(maxBytes)
    : (LOCAL_TEXT_KINDS.has(normalizedKind) ? MAX_LOCAL_TEXT_IMPORT_BYTES : MAX_REMOTE_IMPORT_BYTES);
  if (!Number.isFinite(size) || size < 0) {
    return { ok: false, error: 'Unable to determine file size.' };
  }
  if (size > effectiveMax) {
    const isLocalText = LOCAL_TEXT_KINDS.has(normalizedKind);
    return {
      ok: false,
      error: isLocalText
        ? `Text file too large. Maximum supported size is ${formatBinaryMegabytes(effectiveMax)}.`
        : `File too large for direct upload. Maximum supported size is ${formatBinaryMegabytes(effectiveMax)}.`,
      maxBytes: effectiveMax,
      size,
    };
  }
  return { ok: true, maxBytes: effectiveMax, size };
}
