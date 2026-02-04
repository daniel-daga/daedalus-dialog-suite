import { parentPort } from 'worker_threads';
import { promises as fs } from 'fs';
import { extractFileMetadata, FileMetadata } from '../utils/metadataUtils';

if (parentPort) {
  parentPort.on('message', async (message: { id: string; filePath: string }) => {
    const { id, filePath } = message;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const metadata = extractFileMetadata(content, filePath);

      // Determine if this is a quest file based on symbols found
      const isQuestFile = metadata.symbols.some(s =>
        s.name.startsWith('TOPIC_') || s.name.startsWith('MIS_')
      );

      parentPort!.postMessage({
        id,
        metadata,
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
