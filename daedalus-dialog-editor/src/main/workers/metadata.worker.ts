import { parentPort } from 'worker_threads';
import { promises as fs } from 'fs';
import { extractDialogMetadata, TOPIC_REGEX, MIS_REGEX } from '../utils/metadataUtils';

if (parentPort) {
  parentPort.on('message', async (message: { id: string; filePath: string }) => {
    const { id, filePath } = message;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const dialogs = extractDialogMetadata(content, filePath);

      const isQuestFile = TOPIC_REGEX.test(content) || MIS_REGEX.test(content);

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
