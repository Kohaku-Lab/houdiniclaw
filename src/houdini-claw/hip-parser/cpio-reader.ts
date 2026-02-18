/**
 * CPIO Archive Reader for Houdini .hip files
 *
 * Houdini .hip files are gzip-compressed CPIO archives containing
 * ASCII node definitions and binary geometry data. This module provides
 * a pure TypeScript CPIO reader that works without a Houdini license.
 *
 * References:
 *   - CPIO "newc" (SVR4) format: https://www.mkssoftware.com/docs/man4/cpio.4.asp
 *   - Houdini uses the "newc" (070701) variant
 */

import { gunzipSync } from "node:zlib";

// ── Types ──────────────────────────────────────────────────

export interface CpioEntry {
  /** File path within the archive */
  filename: string;
  /** Raw file content as a Buffer */
  data: Buffer;
  /** File size in bytes */
  filesize: number;
  /** CPIO file mode (permissions + type) */
  mode: number;
}

// ── Constants ──────────────────────────────────────────────

/** CPIO "newc" (SVR4) magic number */
const CPIO_MAGIC = "070701";

/** CPIO header is 110 bytes in "newc" format */
const CPIO_HEADER_SIZE = 110;

/** Trailer entry name marking end of archive */
const CPIO_TRAILER = "TRAILER!!!";

// ── CPIO Parser ────────────────────────────────────────────

/**
 * Parse a CPIO "newc" (SVR4) archive from a raw buffer.
 *
 * The "newc" format header is 110 bytes of ASCII hex:
 *   - 6 bytes magic "070701"
 *   - 8 bytes inode
 *   - 8 bytes mode
 *   - 8 bytes uid
 *   - 8 bytes gid
 *   - 8 bytes nlink
 *   - 8 bytes mtime
 *   - 8 bytes filesize
 *   - 8 bytes devmajor
 *   - 8 bytes devminor
 *   - 8 bytes rdevmajor
 *   - 8 bytes rdevminor
 *   - 8 bytes namesize
 *   - 8 bytes check
 *
 * Filename follows header, padded to 4-byte boundary.
 * Data follows filename, padded to 4-byte boundary.
 */
function parseCpioArchive(buffer: Buffer): CpioEntry[] {
  const entries: CpioEntry[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Need at least a header
    if (offset + CPIO_HEADER_SIZE > buffer.length) {
      break;
    }

    const headerStr = buffer.subarray(offset, offset + CPIO_HEADER_SIZE).toString("ascii");
    const magic = headerStr.slice(0, 6);

    if (magic !== CPIO_MAGIC) {
      // Try to find next magic if we hit garbage (can happen with binary alignment)
      const nextMagic = buffer.indexOf(CPIO_MAGIC, offset + 1, "ascii");
      if (nextMagic === -1) break;
      offset = nextMagic;
      continue;
    }

    // Parse header fields (all 8-char hex strings)
    const mode = parseInt(headerStr.slice(14, 22), 16);
    const filesize = parseInt(headerStr.slice(54, 62), 16);
    const namesize = parseInt(headerStr.slice(94, 102), 16);

    // Filename starts right after the header, padded to 4-byte boundary
    const nameOffset = offset + CPIO_HEADER_SIZE;
    const nameEnd = nameOffset + namesize - 1; // -1 to exclude null terminator
    const namePaddedEnd = align4(nameOffset + namesize);

    if (namePaddedEnd > buffer.length) break;

    const filename = buffer.subarray(nameOffset, nameEnd).toString("utf-8");

    // Check for trailer
    if (filename === CPIO_TRAILER) {
      break;
    }

    // Data starts after padded filename
    const dataOffset = namePaddedEnd;
    const dataEnd = dataOffset + filesize;
    const dataPaddedEnd = align4(dataEnd);

    if (dataEnd > buffer.length) break;

    const data = buffer.subarray(dataOffset, dataEnd);

    entries.push({
      filename,
      data: Buffer.from(data), // Copy to detach from original buffer
      filesize,
      mode,
    });

    offset = dataPaddedEnd;
  }

  return entries;
}

/** Align a value up to the next 4-byte boundary */
function align4(value: number): number {
  return (value + 3) & ~3;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Read a Houdini .hip file buffer and extract CPIO entries.
 *
 * Handles:
 *   - gzip-compressed archives (.hip, .hipnc)
 *   - uncompressed CPIO archives (text-mode .hip)
 *   - 4-byte Houdini header prefix on compressed contents
 */
export function readCpioFromBuffer(buffer: Buffer): CpioEntry[] {
  let raw = buffer;

  // Check for gzip magic (1f 8b)
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    raw = gunzipSync(raw);
  }

  // Check for Houdini's 4-byte header prefix before CPIO magic
  // Some .hip files have a 4-byte flag that must be skipped
  const asStr = raw.subarray(0, 6).toString("ascii");
  if (asStr !== CPIO_MAGIC) {
    // Try skipping 4 bytes (Houdini compressed content flag)
    const after4 = raw.subarray(4, 10).toString("ascii");
    if (after4 === CPIO_MAGIC) {
      raw = raw.subarray(4);
    } else {
      // Try to find CPIO magic anywhere in the first 256 bytes
      const magicIdx = raw.indexOf(CPIO_MAGIC, 0, "ascii");
      if (magicIdx !== -1 && magicIdx < 256) {
        raw = raw.subarray(magicIdx);
      } else {
        throw new Error(
          `Not a valid CPIO archive: magic not found (got ${asStr})`,
        );
      }
    }
  }

  return parseCpioArchive(raw);
}

/**
 * Read a .hip file from disk and extract CPIO entries.
 */
export async function readCpioFromFile(filePath: string): Promise<CpioEntry[]> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  return readCpioFromBuffer(buffer);
}

/**
 * Filter CPIO entries to only include text/ASCII files
 * (skip binary geometry, textures, etc.)
 */
export function filterTextEntries(entries: CpioEntry[]): CpioEntry[] {
  return entries.filter((entry) => {
    // Skip empty entries
    if (entry.filesize === 0) return false;

    // Check if content looks like text (first 512 bytes)
    const sample = entry.data.subarray(0, Math.min(512, entry.data.length));
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      // Allow common text bytes: tab, newline, carriage return, and printable ASCII
      if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
      if (byte >= 0x20 && byte <= 0x7e) continue;
      // Found a non-text byte
      return false;
    }
    return true;
  });
}
