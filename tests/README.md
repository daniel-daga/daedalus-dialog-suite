# Encoding Tests

This directory contains tests for file encoding detection and preservation.

## Running Tests

To run the encoding tests:

```bash
npm run test:encoding
```

## What's Being Tested

### Test 1: Win1250 Encoding Detection
- Creates a file with Windows-1250 encoding containing German and Polish characters
- Verifies that special characters (ä, ö, ü, ą, ć, ę, ł, ń, ó, ś, ź, ż) are correctly preserved
- Confirms encoding is detected as `windows-1250`

### Test 1b: Original File Reading
- Reads the original `win1250.d` file if it exists
- Reports the detected encoding

### Test 2: File Creation and Verification
- Creates a win1250 file programmatically
- Reads it back and verifies content matches

### Test 3: Encoding Preservation on Write
- Writes a file and verifies the encoding is preserved on disk
- Validates by reading the raw buffer with the correct encoding

### Test 4: UTF-8 Handling
- Tests UTF-8 files with international characters and emojis
- Ensures UTF-8 encoding is properly detected and preserved

### Test 5: Round-trip Test
- Reads a file, modifies it, writes it back, and reads again
- Verifies encoding is maintained throughout the entire process
- Checks special characters are preserved after multiple operations

### Test 6: Multiple Files with Different Encodings
- Works with both UTF-8 and Win1250 files simultaneously
- Verifies each file maintains its own encoding
- Tests that the encoding cache correctly tracks different files

## Implementation Details

The FileService uses:
- **chardet**: For automatic encoding detection
- **iconv-lite**: For encoding/decoding with proper character set support
- **In-memory cache**: To remember each file's original encoding

### How It Works

1. When a file is read:
   - The file is read as a raw buffer
   - `chardet` analyzes the byte patterns to detect the encoding
   - Windows-1252 detections are mapped to Windows-1250 (common for Central European files)
   - The detected encoding is cached with the file path
   - The buffer is decoded using the detected encoding

2. When a file is written:
   - The cached encoding for that file path is retrieved
   - If no encoding is cached, UTF-8 is used as default
   - The content is encoded using the correct encoding
   - The encoded buffer is written to disk

This ensures that files always maintain their original encoding, which is critical for compatibility with tools that expect specific encodings (like Gothic 2 modding tools that use Windows-1250).

## Why This Matters

Gothic 2 and many Central European applications use Windows-1250 encoding. If we always save as UTF-8, the game and other tools may not be able to read the special characters correctly. By preserving the original encoding, we ensure compatibility with the existing toolchain.
