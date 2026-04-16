const BYTES_PER_MIB = 1024 * 1024;

export const MAX_MEDIA_IMPORT_BYTES = 5 * BYTES_PER_MIB;

export function formatBinaryMegabytes(bytes) {
  const mib = Number(bytes) / BYTES_PER_MIB;
  if (!Number.isFinite(mib) || mib <= 0) return '0 MiB';
  const rounded = mib >= 10 ? Math.round(mib) : Math.round(mib * 10) / 10;
  return `${rounded} MiB`;
}

export function validateMediaImportSize(file, { maxBytes = MAX_MEDIA_IMPORT_BYTES } = {}) {
  const size = Number(file && file.size);
  if (!Number.isFinite(size) || size < 0) {
    return { ok: false, error: 'Unable to determine file size.' };
  }
  if (size > maxBytes) {
    return {
      ok: false,
      error: `File too large. Maximum supported size is ${formatBinaryMegabytes(maxBytes)}.`,
      maxBytes,
      size,
    };
  }
  return { ok: true, maxBytes, size };
}
