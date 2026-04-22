export function splitSseBlocksFromBuffer(rawBuffer) {
  const buffer = String(rawBuffer ?? '');
  if (!buffer) {
    return { blocks: [], remainder: '' };
  }

  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? '';
  const blocks = parts.filter((part) => String(part || '').trim().length > 0);
  return { blocks, remainder };
}

function collectSseDataLines(rawBlock) {
  const dataLines = [];
  const lines = String(rawBlock ?? '').split(/\r?\n/);

  for (const line of lines) {
    const normalized = String(line ?? '');
    if (!normalized.trim()) continue;

    const lineStartTrimmed = normalized.trimStart();
    if (!lineStartTrimmed || lineStartTrimmed.startsWith(':')) continue;

    const separatorIndex = lineStartTrimmed.indexOf(':');
    if (separatorIndex <= 0) continue;

    const field = lineStartTrimmed.slice(0, separatorIndex).trim();
    if (field !== 'data') continue;

    let value = lineStartTrimmed.slice(separatorIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    dataLines.push(value);
  }

  return dataLines;
}

export function parseSseDataPayload(rawBlock, { onInvalidJson } = {}) {
  const block = String(rawBlock ?? '');
  if (!block.trim()) return null;

  const dataLines = collectSseDataLines(block);
  if (!dataLines.length) return null;

  const payloadText = dataLines.join('\n').trim();
  if (!payloadText) return null;

  try {
    return JSON.parse(payloadText);
  } catch (err) {
    if (typeof onInvalidJson === 'function') {
      try {
        onInvalidJson(payloadText, err);
      } catch (_) {}
    }
    return null;
  }
}

export function readSsePayloadsFromBuffer(rawBuffer, incomingChunk, options = {}) {
  const merged = `${String(rawBuffer ?? '')}${String(incomingChunk ?? '')}`;
  const { blocks, remainder } = splitSseBlocksFromBuffer(merged);
  const payloads = [];

  for (const block of blocks) {
    const payload = parseSseDataPayload(block, options);
    if (payload) payloads.push(payload);
  }

  return { payloads, remainder };
}
