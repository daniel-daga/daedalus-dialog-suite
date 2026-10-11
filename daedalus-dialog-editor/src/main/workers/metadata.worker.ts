import { promises as fs } from 'fs';
import { extractFileMetadataFromSource } from '../utils/semanticMetadataUtils';
import { decodeBuffer } from '../utils/encodingUtils';

// A forked child process rather than a worker thread — see `ForkedWorker`.
const send = process.send?.bind(process);

if (send) {
  process.on('message', async (message: { id: string; filePath: string }) => {
    const { id, filePath } = message;

    try {
      // Stat BEFORE reading: any write racing the read makes the on-disk mtime
      // diverge from the recorded one, so the stale primed model is rejected.
      const stat = await fs.stat(filePath);
      const buffer = await fs.readFile(filePath);
      const { content } = decodeBuffer(buffer);
      const { dialogs, instances, prototypes, isQuestFile, routines, functions, voiceIds, semanticModel, parseErrors } =
        extractFileMetadataFromSource(content, filePath);

      send({
        id,
        dialogs,
        instances,
        prototypes,
        isQuestFile,
        routines,
        functions,
        voiceIds,
        semanticModel,
        parseErrors,
        mtimeMs: stat.mtimeMs
      });
    } catch (error) {
      send({
        id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
