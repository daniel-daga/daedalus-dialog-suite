import { parentPort } from 'worker_threads';
import { promises as fs } from 'fs';
import { extractFileMetadataFromSource } from '../utils/semanticMetadataUtils';

if (parentPort) {
  parentPort.on('message', async (message: { id: string; filePath: string }) => {
    const { id, filePath } = message;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { dialogs, isQuestFile } = extractFileMetadataFromSource(content, filePath);

      parentPort!.postMessage({
        id,
        dialogs,
        isQuestFile
      });
    } catch (error) {
      parentPort!.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
