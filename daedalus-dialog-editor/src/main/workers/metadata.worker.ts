import { parentPort } from 'worker_threads';
import { promises as fs } from 'fs';
import { extractFileMetadataFromSource } from '../utils/semanticMetadataUtils';
import { decodeBuffer } from '../utils/encodingUtils';

if (parentPort) {
  parentPort.on('message', async (message: { id: string; filePath: string }) => {
    const { id, filePath } = message;

    try {
      const buffer = await fs.readFile(filePath);
      const { content } = decodeBuffer(buffer);
      const { dialogs, instances, prototypes, isQuestFile, routines, voiceIds } = extractFileMetadataFromSource(content, filePath);

      parentPort!.postMessage({
        id,
        dialogs,
        instances,
        prototypes,
        isQuestFile,
        routines,
        voiceIds
      });
    } catch (error) {
      parentPort!.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
