import * as fs from 'fs';

// The packaged-app open-world smoke (build-windows.yml). The startup smoke
// proved the exe launches; this proves the thing packaging can silently break —
// the native addon loads in the packaged Electron and reads a real ZEN. Driven
// through WorldService.openWorld, the exact call the world:open IPC handler
// makes, so the worker spawn, the asar-unpacked dlopen and the summary all run
// as they would for a user. Env-gated in main.ts; inert in production.

export interface OpenWorldSmokeResult {
  ok: boolean;
  vobCount?: number;
  worldTriangles?: number;
  error?: string;
}

/** The slice of WorldService the smoke drives — injected in tests. */
export interface SmokeWorldService {
  openWorld(request: {
    worldPath: string;
    gameVersion: 'g2';
    assetSources: string[];
  }): Promise<{ stats: { vobCount: number; worldTriangles: number } }>;
  close(): void;
}

export async function runOpenWorldSmoke(
  worldService: SmokeWorldService,
  worldPath: string,
  resultPath: string | undefined,
): Promise<OpenWorldSmokeResult> {
  let result: OpenWorldSmokeResult;
  try {
    // assetSources: [] — the committed fixture needs no Gothic install, and an
    // empty list at the service level mounts an empty VFS (the IPC handler's
    // derive-from-install rule lives above this call and is not under test).
    const summary = await worldService.openWorld({
      worldPath,
      gameVersion: 'g2',
      assetSources: [],
    });
    const { vobCount, worldTriangles } = summary.stats;
    if (vobCount > 0 && worldTriangles > 0) {
      result = { ok: true, vobCount, worldTriangles };
    } else {
      result = {
        ok: false,
        error: `implausible summary: vobCount=${vobCount} worldTriangles=${worldTriangles}`,
      };
    }
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  worldService.close();

  if (resultPath) {
    fs.writeFileSync(resultPath, JSON.stringify(result));
  }
  // The exit code is the primary verdict; the log line is for the CI transcript.
  console.log(`[smoke] open-world ${result.ok ? 'OK' : 'FAILED'}: ${JSON.stringify(result)}`);
  return result;
}
