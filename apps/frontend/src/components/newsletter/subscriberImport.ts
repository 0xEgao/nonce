import type { AddSubscriberEntry } from '@nonce/shared';

// Mirrors the column lengths the API validates against.
export const EMAIL_MAX_LENGTH = 320;
export const SUBSCRIBER_NAME_MAX_LENGTH = 255;
/** AddSubscribersRequest takes 1..5000 entries. */
export const MAX_IMPORT_SUBSCRIBERS = 5000;

// Deliberately loose: it only has to tell an address from a name. The API
// applies the real check and reports what it rejects in `invalid`.
const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

export const looksLikeEmail = (value: string): boolean =>
  value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value);

export interface ParsedSubscribers {
  /** De-duplicated by address, lowercased. */
  entries: AddSubscriberEntry[];
  /** Lines that held no usable address, as typed. */
  invalid: string[];
  /** Repeats of an address already seen in the same batch. */
  duplicates: number;
}

const cleanName = (raw: string | undefined): string | undefined => {
  const name = (raw ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[<>\r\n]+/g, ' ')
    .trim()
    .slice(0, SUBSCRIBER_NAME_MAX_LENGTH);
  return name || undefined;
};

// `Jane Doe <jane@example.com>`, with or without quotes around the name.
const NAME_AND_ADDRESS = /^(.*?)<\s*([^<>]*?)\s*>$/;

/**
 * One subscriber per line. Understands `email`, `email,name`, `name,email`,
 * `Name <email>`, tab- or semicolon-separated cells pasted from a sheet, and
 * several bare addresses on one line.
 */
export const parseSubscriberText = (text: string): ParsedSubscribers => {
  const byEmail = new Map<string, AddSubscriberEntry>();
  const invalid: string[] = [];
  let duplicates = 0;

  const add = (rawEmail: string, rawName?: string) => {
    const email = rawEmail.trim().toLowerCase();
    const name = cleanName(rawName);
    const existing = byEmail.get(email);
    if (existing) {
      duplicates += 1;
      if (!existing.name && name) existing.name = name;
      return;
    }
    byEmail.set(email, name ? { email, name } : { email });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const named = NAME_AND_ADDRESS.exec(line);
    if (named) {
      if (looksLikeEmail(named[2])) add(named[2], named[1]);
      else invalid.push(line);
      continue;
    }

    const cells = line
      .split(/[,;\t]/)
      .map(cell =>
        cell
          .trim()
          .replace(/^"+|"+$/g, '')
          .trim()
      )
      .filter(Boolean);
    const addresses = cells.filter(looksLikeEmail);
    if (addresses.length === 0) {
      invalid.push(line);
    } else if (addresses.length > 1) {
      addresses.forEach(address => add(address));
    } else {
      add(
        addresses[0],
        cells.find(cell => cell !== addresses[0])
      );
    }
  }

  return { entries: [...byEmail.values()], invalid, duplicates };
};

const detectDelimiter = (text: string): string => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
};

/** RFC 4180: quoted cells, doubled quotes, newlines inside quotes, BOM. */
export const parseCsv = (input: string): string[][] => {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter(cells => cells.some(value => value.trim() !== ''));
};

const EMAIL_HEADER = /^e[-_ ]?mail([-_ ]?address)?$/i;
const NAME_HEADER = /^(full[-_ ]?)?name$/i;
const FIRST_NAME_HEADER = /^first[-_ ]?name$/i;
const LAST_NAME_HEADER = /^(last|sur)[-_ ]?name$/i;

export interface CsvImport {
  /** `email` or `Name <email>` lines, ready for the paste box. */
  lines: string[];
  /** Whether an `email` header column was found; otherwise column one is used. */
  usedHeader: boolean;
}

/**
 * Reads the `email` column when the header row has one (plus a `name` column,
 * or first/last name), otherwise treats column one as the address and column
 * two as the name. Output goes through the same parser as pasted text, so
 * both routes validate identically.
 */
export const csvToSubscriberLines = (csv: string): CsvImport => {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { lines: [], usedHeader: false };

  const header = rows[0].map(cell => cell.trim());
  const emailColumn = header.findIndex(cell => EMAIL_HEADER.test(cell));
  const usedHeader = emailColumn !== -1;

  let dataRows = rows;
  let emailIndex = 0;
  let nameIndexes: number[] = [];
  if (usedHeader) {
    dataRows = rows.slice(1);
    emailIndex = emailColumn;
    const nameColumn = header.findIndex(cell => NAME_HEADER.test(cell));
    const firstColumn = header.findIndex(cell => FIRST_NAME_HEADER.test(cell));
    const lastColumn = header.findIndex(cell => LAST_NAME_HEADER.test(cell));
    nameIndexes =
      nameColumn !== -1
        ? [nameColumn]
        : [firstColumn, lastColumn].filter(index => index !== -1);
  } else if (rows.some(cells => cells.length > 1)) {
    nameIndexes = [1];
  }

  const lines: string[] = [];
  for (const cells of dataRows) {
    const email = (cells[emailIndex] ?? '').trim();
    if (!email) continue;
    const name = cleanName(
      nameIndexes
        .map(index => (cells[index] ?? '').trim())
        .filter(Boolean)
        .join(' ')
    );
    lines.push(name ? `${name} <${email}>` : email);
  }
  return { lines, usedHeader };
};
