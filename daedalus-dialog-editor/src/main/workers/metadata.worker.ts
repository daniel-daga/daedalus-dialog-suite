import { parentPort } from 'worker_threads';
import { promises as fs } from 'fs';
import { extractFileMetadataFromSource } from '../utils/semanticMetadataUtils';
import { decodeBuffer } from '../utils/encodingUtils';

if (parentPort) {
  parentPort.on('message', async (message: { id: string; filePath: string }) => {
    const { id, filePath } = message;

    try {
      // Stat BEFORE reading: any write racing the read makes the on-disk mtime
      // diverge from the recorded one, so the stale primed model is rejected.
      const stat = await fs.stat(filePath);
      const buffer = await fs.readFile(filePath);
      const { content } = decodeBuffer(buffer);
      const { dialogs, instances, prototypes, isQuestFile, routines, voiceIds, semanticModel } =
        extractFileMetadataFromSource(content, filePath);

      parentPort!.postMessage({
        id,
        dialogs,
        instances,
        prototypes,
        isQuestFile,
        routines,
        voiceIds,
        semanticModel,
        mtimeMs: stat.mtimeMs
      });
    } catch (error) {
      parentPort!.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
