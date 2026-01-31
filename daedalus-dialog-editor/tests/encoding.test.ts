import { FileService } from '../src/main/services/FileService';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as iconv from 'iconv-lite';

/**
 * Test suite for file encoding detection and preservation
 * Run with: npx tsx tests/encoding.test.ts
 */

async function runTests() {
  const fileService = new FileService();
  const testDir = path.join(__dirname, 'test-files');
  let failedTests = 0;
  let passedTests = 0;

  console.log('Starting encoding tests...\n');

  // Setup: Create test directory
  await fs.mkdir(testDir, { recursive: true });

  try {
    // Test 1: Create and read actual win1250 file
    console.log('Test 1: Creating and reading actual win1250 encoded file...');
    const actualWin1250File = path.join(testDir, 'actual-win1250.d');
    const testContentWithSpecialChars = '// Test file with Central European characters\n// müssen, Glück, Knödel, ąćęłńóśźż\nvar int test = 1;';

    try {
      // Create a real win1250 file
      const win1250Buffer = iconv.encode(testContentWithSpecialChars, 'windows-1250');
      await fs.writeFile(actualWin1250File, win1250Buffer);

      // Read it with our service
      const content = await fileService.readFile(actualWin1250File);
      const encoding = fileService.getFileEncoding(actualWin1250File);

      console.log(`  ✓ Detected encoding: ${encoding}`);

      // Check for special characters
      const hasGermanChars = content.includes('müssen') && content.includes('Glück') && content.includes('Knödel');
      const hasPolishChars = content.includes('ąćęłńóśźż');

      if (hasGermanChars && hasPolishChars && content === testContentWithSpecialChars) {
        console.log('  ✓ All special characters preserved correctly');
        console.log(`  ✓ Content matches: ${content.substring(0, 50)}...`);
        passedTests++;
      } else {
        console.log('  ✗ Special characters not preserved correctly');
        console.log(`    Expected: ${testContentWithSpecialChars.substring(0, 50)}...`);
        console.log(`    Got: ${content.substring(0, 50)}...`);
        failedTests++;
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error}`);
      failedTests++;
    }

    // Test 1b: Read original win1250.d if it exists
    console.log('\nTest 1b: Reading original win1250.d file...');
    const win1250File = path.join(__dirname, '..', 'win1250.d');
    try {
      const content = await fileService.readFile(win1250File);
      const encoding = fileService.getFileEncoding(win1250File);

      console.log(`  ✓ Successfully read file`);
      console.log(`  ✓ Detected encoding: ${encoding}`);
      console.log(`  ✓ File length: ${content.length} characters`);
      passedTests++;
    } catch (error) {
      console.log(`  ⚠ Could not read original file (might not exist): ${error}`);
      // Don't count as failure
    }

    // Test 2: Create a win1250 file and verify encoding preservation
    console.log('\nTest 2: Creating and verifying win1250 file...');
    const testWin1250File = path.join(testDir, 'test-win1250.d');
    const testContent = '// Test with special chars: müssen, Glück, Knödel\nvar int test = 1;';

    try {
      // Manually create a win1250 file
      await fs.writeFile(testWin1250File, iconv.encode(testContent, 'win1250'));

      // Read it with our service
      const readContent = await fileService.readFile(testWin1250File);
      const detectedEncoding = fileService.getFileEncoding(testWin1250File);

      console.log(`  ✓ Detected encoding: ${detectedEncoding}`);

      if (readContent === testContent) {
        console.log('  ✓ Content matches original');
        passedTests++;
      } else {
        console.log('  ✗ Content does not match');
        console.log(`    Expected: ${testContent}`);
        console.log(`    Got: ${readContent}`);
        failedTests++;
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error}`);
      failedTests++;
    }

    // Test 3: Write file and verify encoding is preserved
    console.log('\nTest 3: Writing file with preserved encoding...');
    try {
      const readContent = await fileService.readFile(testWin1250File);
      const modifiedContent = readContent + '\n// Modified with special chars: äöü';

      await fileService.writeFile(testWin1250File, modifiedContent);

      // Read back the raw buffer to check encoding
      const buffer = await fs.readFile(testWin1250File);
      const decodedWin1250 = iconv.decode(buffer, 'win1250');

      if (decodedWin1250 === modifiedContent) {
        console.log('  ✓ File written with correct encoding (win1250)');
        passedTests++;
      } else {
        console.log('  ✗ Encoding not preserved on write');
        failedTests++;
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error}`);
      failedTests++;
    }

    // Test 4: UTF-8 file handling
    console.log('\nTest 4: UTF-8 file handling...');
    const testUtf8File = path.join(testDir, 'test-utf8.d');
    const utf8Content = '// UTF-8 test: 你好 world, emoji: 🎉\nvar int test = 1;';

    try {
      await fs.writeFile(testUtf8File, utf8Content, 'utf8');

      const readContent = await fileService.readFile(testUtf8File);
      const detectedEncoding = fileService.getFileEncoding(testUtf8File);

      console.log(`  ✓ Detected encoding: ${detectedEncoding}`);

      if (readContent === utf8Content) {
        console.log('  ✓ UTF-8 content preserved correctly');
        passedTests++;
      } else {
        console.log('  ✗ UTF-8 content not preserved');
        failedTests++;
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error}`);
      failedTests++;
    }

    // Test 5: Round-trip test with encoding verification
    console.log('\nTest 5: Round-trip test (read, modify, write, read) with encoding verification...');
    try {
      const content1 = await fileService.readFile(actualWin1250File);
      const originalEncoding = fileService.getFileEncoding(actualWin1250File);
      const modifiedContent = content1 + '\n// Round trip with ąöü';

      await fileService.writeFile(actualWin1250File, modifiedContent);
      const content2 = await fileService.readFile(actualWin1250File);

      // Verify encoding was preserved by reading the raw file
      const rawBuffer = await fs.readFile(actualWin1250File);
      const decodedWithWin1250 = iconv.decode(rawBuffer, 'windows-1250');

      if (content2 === modifiedContent && decodedWithWin1250 === modifiedContent) {
        console.log('  ✓ Round-trip successful');
        console.log(`  ✓ Encoding preserved: ${originalEncoding}`);
        console.log('  ✓ Special characters maintained through round-trip');
        passedTests++;
      } else {
        console.log('  ✗ Round-trip failed');
        console.log(`    Content match: ${content2 === modifiedContent}`);
        console.log(`    Encoding preserved: ${decodedWithWin1250 === modifiedContent}`);
        failedTests++;
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error}`);
      failedTests++;
    }

    // Test 6: Multiple files with different encodings
    console.log('\nTest 6: Multiple files with different encodings...');
    try {
      const utf8File = path.join(testDir, 'multi-utf8.d');
      const win1250FileMulti = path.join(testDir, 'multi-win1250.d');

      // Create UTF-8 file
      await fs.writeFile(utf8File, 'UTF-8: 你好世界 🎉', 'utf8');
      // Create win1250 file
      await fs.writeFile(win1250FileMulti, iconv.encode('Win1250: ąćęłńóśźż', 'windows-1250'));

      // Read both
      const utf8Content = await fileService.readFile(utf8File);
      const win1250Content = await fileService.readFile(win1250FileMulti);

      const utf8Encoding = fileService.getFileEncoding(utf8File);
      const win1250Encoding = fileService.getFileEncoding(win1250FileMulti);

      console.log(`  ✓ UTF-8 file encoding: ${utf8Encoding}`);
      console.log(`  ✓ Win1250 file encoding: ${win1250Encoding}`);

      // Modify and write back
      await fileService.writeFile(utf8File, utf8Content + ' modified');
      await fileService.writeFile(win1250FileMulti, win1250Content + ' zmieniony');

      // Verify encodings were preserved
      const utf8Buffer = await fs.readFile(utf8File);
      const win1250Buffer = await fs.readFile(win1250FileMulti);

      const utf8Check = utf8Buffer.toString('utf8') === 'UTF-8: 你好世界 🎉 modified';
      const win1250Check = iconv.decode(win1250Buffer, 'windows-1250') === 'Win1250: ąćęłńóśźż zmieniony';

      if (utf8Check && win1250Check) {
        console.log('  ✓ Both encodings preserved correctly');
        passedTests++;
      } else {
        console.log('  ✗ Encoding preservation failed');
        console.log(`    UTF-8 check: ${utf8Check}`);
        console.log(`    Win1250 check: ${win1250Check}`);
        failedTests++;
      }
    } catch (error) {
      console.log(`  ✗ Failed: ${error}`);
      failedTests++;
    }

  } finally {
    // Cleanup
    console.log('\nCleaning up test files...');
    await fs.rm(testDir, { recursive: true, force: true });
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Tests passed: ${passedTests}`);
  console.log(`Tests failed: ${failedTests}`);
  console.log('='.repeat(50));

  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
