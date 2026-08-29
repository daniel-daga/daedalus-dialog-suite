import type { FileService } from './FileService';
import type { FileWatcherService } from './FileWatcherService';
import type { ParserService } from './ParserService';
import type { CodeGeneratorService } from './CodeGeneratorService';
import type { ValidationService } from './ValidationService';
import { PathValidationError, type PathValidationService } from './PathValidationService';
import { assertModelShape, assertSaveFileSettings, assertSaveFileOptions } from '../ipcValidation';

/**
 * The save pipeline: assert the payload, validate the path, validate the
 * model, write, and only then arm the watcher's self-write suppression.
 *
 * It was the body of the `generator:saveFile` IPC handler and is a function
 * here so a second main-side caller shares the pipeline instead of copying it
 * (mcp-server.md §2). Behavior is unchanged — including that the caller sees a
 * refusal as a returned `ValidationResult` and a failure as a thrown Error.
 */
export interface SaveFileDeps {
  pathValidator: Pick<PathValidationService, 'validatePathResolved'>;
  validationService: Pick<ValidationService, 'validate'>;
  codeGeneratorService: Pick<CodeGeneratorService, 'generateCode'>;
  parserService: Pick<ParserService, 'parseSource'>;
  fileService: Pick<FileService, 'writeFile'>;
  fileWatcherService: Pick<FileWatcherService, 'notifySelfWrite'>;
}

export interface SaveFileFlowOptions {
  skipValidation?: boolean;
  forceOnErrors?: boolean;
  overwriteExternal?: boolean;
  existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>>;
}

export async function saveFileFlow(
  deps: SaveFileDeps,
  filePath: string,
  model: any,
  settings: any,
  options?: SaveFileFlowOptions
): Promise<any> {
  const expectUnchanged = !options?.overwriteExternal;
  // Force-on-errors overwrites drop content the parser could not read, so
  // FileService first snapshots the on-disk file to `<name>.d.bak`.
  const backupBeforeWrite = options?.forceOnErrors === true;
  try {
    // Validate payload shapes before touching services
    assertModelShape(model);
    assertSaveFileSettings(settings);
    assertSaveFileOptions(options);

    // Validate path before saving (symlink-resolved, write mode)
    await deps.pathValidator.validatePathResolved(filePath, { write: true });

    // Validate model unless explicitly skipped
    if (!options?.skipValidation) {
      const validationResult = await deps.validationService.validate(model, settings, {
        existingVoiceIds: options?.existingVoiceIds
      });

      // If validation failed and not forcing save, return validation result
      if (!validationResult.isValid && !options?.forceOnErrors) {
        console.warn(`[IPC] generator:saveFile - Validation failed for ${filePath}, skipping save.`);
        return {
          success: false,
          validationResult
        };
      }

      // Use pre-generated code from validation if available
      if (validationResult.generatedCode) {
        const writeResult = await deps.fileService.writeFile(filePath, validationResult.generatedCode, { expectUnchanged, backupBeforeWrite });
        // Arm self-write suppression only after an actual write succeeds
        deps.fileWatcherService.notifySelfWrite(filePath);
        return {
          ...writeResult,
          validationResult
        };
      }
    }

    // Fallback: generate code directly (only if validation skipped or didn't provide code)
    const code = deps.codeGeneratorService.generateCode(model, settings, { allowPartialModel: options?.forceOnErrors === true });

    // Final sanity check for generated code - ALWAYS run this if we are falling back
    const syntaxResult = await deps.parserService.parseSource(code);
    if (syntaxResult.hasErrors && !options?.forceOnErrors) {
        return {
            success: false,
            validationResult: {
                isValid: false,
                errors: syntaxResult.errors?.map((e: any) => ({
                    type: 'syntax_error' as const,
                    message: e.message || 'Syntax error',
                    position: e.position
                })) || [{
                    type: 'syntax_error' as const,
                    message: 'Syntax error detected (sanity check)',
                }],
                warnings: []
            }
        };
    }

    const writeResult = await deps.fileService.writeFile(filePath, code, { expectUnchanged, backupBeforeWrite });
    // Arm self-write suppression only after an actual write succeeds
    deps.fileWatcherService.notifySelfWrite(filePath);
    return writeResult;
  } catch (error) {
    if (error instanceof PathValidationError) {
      console.error('[IPC] generator:saveFile - Path validation failed:', error.message);
      throw new Error(error.message);
    }
    console.error('[IPC] generator:saveFile error:', error);
    throw new Error(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
