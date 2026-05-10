const MONTH_TOKEN_MAP = new Map([
  ['jan', 1], ['janeiro', 1],
  ['fev', 2], ['fevereiro', 2],
  ['mar', 3], ['marco', 3], ['março', 3],
  ['abr', 4], ['abril', 4],
  ['mai', 5], ['maio', 5],
  ['jun', 6], ['junho', 6],
  ['jul', 7], ['julho', 7],
  ['ago', 8], ['agosto', 8],
  ['set', 9], ['setembro', 9],
  ['out', 10], ['outubro', 10],
  ['nov', 11], ['novembro', 11],
  ['dez', 12], ['dezembro', 12],
]);

const DATE_SEARCH_NOISE_WORDS = new Set([
  'data', 'datas', 'prazo', 'prazos', 'publicacao', 'publicação',
  'abertura', 'publicado', 'publicada', 'publicadas', 'publicados', 'final',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'ate', 'até',
]);

export function normalizeSearchToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extractMonthNumber(token) {
  if (!token) return null;
  const normalized = normalizeSearchToken(token).replace(/\.$/, '');
  return MONTH_TOKEN_MAP.get(normalized) || null;
}

function isMeaningfulTextForDate(text) {
  const tokens = normalizeSearchToken(text)
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) return false;
  return tokens.some((token) => !DATE_SEARCH_NOISE_WORDS.has(token) && token.length > 2);
}

export function parseDateIntentFromQuery(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return null;

  const directDmy = query.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](19\d{2}|20\d{2}|21\d{2})\b/);
  if (directDmy) {
    const day = Number(directDmy[1]);
    const month = Number(directDmy[2]);
    const year = Number(directDmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { kind: 'day', day, month, year, consumed: directDmy[0] };
    }
  }

  const monthYearNumeric = query.match(/\b(\d{1,2})[\/-](19\d{2}|20\d{2}|21\d{2})\b/);
  if (monthYearNumeric) {
    const month = Number(monthYearNumeric[1]);
    const year = Number(monthYearNumeric[2]);
    if (month >= 1 && month <= 12) {
      return { kind: 'month', month, year, consumed: monthYearNumeric[0] };
    }
  }

  const monthYearNamed = query.match(/\b([A-Za-zÀ-ÿçÇ.]{3,})(?:\s+de)?[\/\s-]+(19\d{2}|20\d{2}|21\d{2})\b/i);
  if (monthYearNamed) {
    const month = extractMonthNumber(monthYearNamed[1]);
    const year = Number(monthYearNamed[2]);
    if (month && year) {
      return { kind: 'month', month, year, consumed: monthYearNamed[0] };
    }
  }

  const yearOnly = query.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (yearOnly) {
    return { kind: 'year', year: Number(yearOnly[1]), consumed: yearOnly[0] };
  }

  return null;
}

export function buildSearchQueryContext(rawQuery) {
  const raw = String(rawQuery || '').trim();
  const dateIntent = parseDateIntentFromQuery(raw);

  if (!dateIntent) {
    return {
      raw,
      textQuery: raw,
      dateIntent: null,
      hasMeaningfulText: raw.length > 0,
    };
  }

  const textQuery = raw
    .replace(dateIntent.consumed, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    raw,
    textQuery,
    dateIntent,
    hasMeaningfulText: isMeaningfulTextForDate(textQuery),
  };
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

export function parseAnyDateToTime(dateString) {
  if (dateString === null || dateString === undefined || dateString === '') return null;
  const s = String(dateString).trim();
  if (!s) return null;

  const epoch = parseEpochDateToTime(s);
  if (epoch !== null) return epoch;

  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (isValidDateParts(year, month, day)) return new Date(year, month - 1, day).getTime();
    return null;
  }

  const dmyDate = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](19\d{2}|20\d{2}|21\d{2})$/);
  if (dmyDate) {
    const day = Number(dmyDate[1]);
    const month = Number(dmyDate[2]);
    const year = Number(dmyDate[3]);
    if (isValidDateParts(year, month, day)) return new Date(year, month - 1, day).getTime();
    return null;
  }

  const monthYearNumeric = s.match(/^(\d{1,2})[\/-](19\d{2}|20\d{2}|21\d{2})$/);
  if (monthYearNumeric) {
    const month = Number(monthYearNumeric[1]);
    const year = Number(monthYearNumeric[2]);
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1).getTime();
    return null;
  }

  const monthYearNamed = s.match(/^([A-Za-zÀ-ÿçÇ.]{3,})(?:\s+de)?[\/\s-]+(19\d{2}|20\d{2}|21\d{2})$/i);
  if (monthYearNamed) {
    const month = extractMonthNumber(monthYearNamed[1]);
    const year = Number(monthYearNamed[2]);
    if (month && year) return new Date(year, month - 1, 1).getTime();
    return null;
  }

  const yearOnly = s.match(/^(19\d{2}|20\d{2}|21\d{2})$/);
  if (yearOnly) {
    return new Date(Number(yearOnly[1]), 0, 1).getTime();
  }

  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function parseEpochDateToTime(value) {
  const s = String(value || '').trim();
  if (!/^\d{10,13}(?:\.0+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const ms = s.replace(/\.0+$/, '').length <= 10 ? n * 1000 : n;
  const min = Date.UTC(2000, 0, 1);
  const max = Date.UTC(2100, 11, 31, 23, 59, 59);
  if (ms < min || ms > max) return null;
  return ms;
}

export function collectEditalDateParts(edital) {
  const rawValues = [
    edital?.data_fechamento,
    edital?.data_publicacao,
    edital?.data_abertura,
    edital?.data_publicacao_edital,
    edital?.data_inicio_submissao,
    edital?.created_at,
    edital?.updated_at,
  ];

  const seen = new Set();
  const out = [];

  rawValues.forEach((rawValue) => {
    const time = parseAnyDateToTime(rawValue);
    if (time === null) return;
    const d = new Date(time);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });
  });

  return out;
}

export function matchesDateIntent(edital, dateIntent) {
  if (!dateIntent) return true;
  const parts = collectEditalDateParts(edital);
  if (!parts.length) return false;

  if (dateIntent.kind === 'day') {
    return parts.some((p) =>
      p.year === dateIntent.year &&
      p.month === dateIntent.month &&
      p.day === dateIntent.day
    );
  }

  if (dateIntent.kind === 'month') {
    return parts.some((p) =>
      p.year === dateIntent.year &&
      p.month === dateIntent.month
    );
  }

  if (dateIntent.kind === 'year') {
    return parts.some((p) => p.year === dateIntent.year);
  }

  return false;
}
