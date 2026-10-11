// Types for the OutputUnit reader (#264). It is deliberately reachable without
// going through `lib/index.js`: that entry loads the native addon, and reading
// an OU database is pure JS over the container walkers.

/** One `zCCSBlock` — a single spoken line, as the database records it. */
export interface OutputUnit {
  /** The `AI_Output` id the block is named for, e.g. `DIA_Alrik_Teach_15_00`. */
  name: string;
  /** The subtitle the game shows for it. */
  text: string;
  /** The WAV the block names. */
  wav: string;
}

export interface OutputUnitDatabase {
  /** The archive flavour it was read from: `ASCII`, `BIN_SAFE` (the retail
   *  `OU.BIN`) or `BINARY`. */
  format: string;
  /** Every block, in file order. */
  units: OutputUnit[];
}

export function readOutputUnits(buf: Buffer): OutputUnitDatabase;

/** A line the scripts hold: the `AI_Output` id and the subtitle beside it. */
export interface OutputUnitLine {
  name: string;
  text: string;
}

/** The file with `lines` set into it, in the format it was in (#264): matching
 *  entries take the new text, missing ones are added, every other entry kept. */
export function rewriteOutputUnits(original: Buffer, lines: OutputUnitLine[]): Buffer;
