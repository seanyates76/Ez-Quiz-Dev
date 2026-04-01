const SUPPORTED_KINDS = new Set(['pdf', 'png', 'jpeg', 'gif']);
const MIME_KIND_MAP = new Map([
  ['application/pdf', 'pdf'],
  ['image/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/pjpeg', 'jpeg'],
  ['image/gif', 'gif'],
]);
const EXTENSION_KIND_MAP = new Map([
  ['pdf', 'pdf'],
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['gif', 'gif'],
]);

export async function sniffFileKind(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());

    // PDF: "%PDF"
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
      return 'pdf';
    }
    // PNG: 89 50 4E 47
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) {
      return 'png';
    }
    // JPEG: FF D8 FF (next marker varies)
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return 'jpeg';
    }
    // GIF87a / GIF89a: 47 49 46 38
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
      return 'gif';
    }
  } catch {
    // Ignore read errors and fall through to unknown
  }
  return 'unknown';
}

export function getImportKindFromMime(type) {
  if (!type) return 'unknown';
  return MIME_KIND_MAP.get(String(type).trim().toLowerCase()) || 'unknown';
}

export function getImportKindFromName(name) {
  if (!name) return 'unknown';
  const match = String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return 'unknown';
  return EXTENSION_KIND_MAP.get(match[1]) || 'unknown';
}

export function hasImportMetadataMismatch(file, sniffedKind) {
  if (!isSupportedImportKind(sniffedKind)) return false;

  const mimeKind = getImportKindFromMime(file && file.type);
  if (mimeKind !== 'unknown' && mimeKind !== sniffedKind) {
    return true;
  }

  const nameKind = getImportKindFromName(file && file.name);
  if (nameKind !== 'unknown' && nameKind !== sniffedKind) {
    return true;
  }

  return false;
}

export function isSupportedImportKind(kind) {
  return SUPPORTED_KINDS.has(kind);
}
