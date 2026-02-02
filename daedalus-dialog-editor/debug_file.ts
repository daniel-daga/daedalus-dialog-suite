import * as fs from 'fs';
import * as path from 'path';
import { extractDialogMetadata, TOPIC_REGEX, MIS_REGEX } from './src/main/utils/metadataUtils';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npx tsx debug_file.ts <path/to/your/file.d>');
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
console.log(`\nAnalyzing file: ${absolutePath}`);

if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File not found at ${absolutePath}`);
    process.exit(1);
}

try {
  const content = fs.readFileSync(absolutePath, 'utf-8');

  // 1. Check Quest File Markers
  console.log('\n--- Quest File Detection ---');
  
  // Use global regex to find ALL occurrences
  const ALL_TOPIC_REGEX = new RegExp(TOPIC_REGEX, 'gi');
  const ALL_MIS_REGEX = new RegExp(MIS_REGEX, 'gi');

  const topicMatches = content.match(ALL_TOPIC_REGEX) || [];
  const misMatches = content.match(ALL_MIS_REGEX) || [];
  
  console.log(`Contains TOPIC_ constants: ${topicMatches.length > 0 ? 'YES' : 'NO'}`);
  if (topicMatches.length > 0) {
      console.log(`  Found ${topicMatches.length} topics:`);
      topicMatches.forEach(m => console.log(`    > ${m.trim()}`));
  }
  
  console.log(`Contains MIS_ variables:   ${misMatches.length > 0 ? 'YES' : 'NO'}`);
  if (misMatches.length > 0) {
      console.log(`  Found ${misMatches.length} variables:`);
      misMatches.forEach(m => console.log(`    > ${m.trim()}`));
  }

  const isQuestFile = topicMatches.length > 0 || misMatches.length > 0;
  console.log(`\nRESULT: ${isQuestFile ? '✅ REGISTERED as Quest File' : '❌ NOT registered as Quest File'}`);

  // 2. Check Dialog Metadata
  console.log('\n--- Dialog Detection ---');
  const dialogs = extractDialogMetadata(content, absolutePath);
  
  if (dialogs.length > 0) {
      console.log(`Found ${dialogs.length} dialog(s):`);
      dialogs.forEach(d => {
          console.log(`  - ${d.dialogName} (NPC: ${d.npc})`);
      });
  } else {
      console.log('No dialog instances found.');
  }

} catch (err) {
  console.error('Error processing file:', err);
}
