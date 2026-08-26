/**
 * Tests for IPC payload shape assertions used at the main-process boundary.
 *
 * @jest-environment node
 */

import { describe, it, expect } from '@jest/globals';
import {
  assertModelShape,
  assertDialogName,
  assertSaveFileSettings,
  assertSaveFileOptions,
  assertOpenWorldRequest,
  assertTextureRequest,
  sanitizeRendererErrorPayload,
  RENDERER_ERROR_MESSAGE_MAX,
  RENDERER_ERROR_STACK_MAX,
} from '../src/main/ipcValidation';

describe('assertModelShape', () => {
  it('rejects null', () => {
    expect(() => assertModelShape(null)).toThrow(/model payload/i);
  });

  it('rejects a string', () => {
    expect(() => assertModelShape('string')).toThrow(/model payload/i);
  });

  it('rejects an array', () => {
    expect(() => assertModelShape([])).toThrow(/model payload/i);
  });

  it('rejects a model whose dialogs field is not an object', () => {
    expect(() => assertModelShape({ dialogs: 42 })).toThrow(/dialogs/i);
  });

  it('rejects a model whose functions field is not an object', () => {
    expect(() => assertModelShape({ functions: 'nope' })).toThrow(/functions/i);
  });

  it('accepts a plain object model', () => {
    expect(() => assertModelShape({})).not.toThrow();
    expect(() => assertModelShape({ dialogs: {}, functions: {} })).not.toThrow();
  });
});

describe('assertDialogName', () => {
  it('rejects a non-string name', () => {
    expect(() => assertDialogName(42)).toThrow(/dialog name/i);
    expect(() => assertDialogName(undefined)).toThrow(/dialog name/i);
  });

  it('accepts a string name', () => {
    expect(() => assertDialogName('DIA_Test')).not.toThrow();
  });
});

describe('assertSaveFileSettings', () => {
  it('accepts undefined', () => {
    expect(() => assertSaveFileSettings(undefined)).not.toThrow();
  });

  it('accepts a plain object', () => {
    expect(() => assertSaveFileSettings({})).not.toThrow();
  });

  it('rejects a non-object (array / string)', () => {
    expect(() => assertSaveFileSettings([])).toThrow(/settings/i);
    expect(() => assertSaveFileSettings('x')).toThrow(/settings/i);
  });
});

describe('assertSaveFileOptions', () => {
  it('accepts undefined', () => {
    expect(() => assertSaveFileOptions(undefined)).not.toThrow();
  });

  it('accepts known boolean options', () => {
    expect(() =>
      assertSaveFileOptions({ skipValidation: true, forceOnErrors: false, overwriteExternal: true })
    ).not.toThrow();
  });

  it('rejects an unknown key', () => {
    expect(() => assertSaveFileOptions({ evil: true })).toThrow(/option/i);
  });

  it('accepts known keys with undefined values (structured clone keeps them)', () => {
    // fileStore.saveFile sends { forceOnErrors: options?.forceOnErrors, ... },
    // so absent flags arrive as keys with undefined values over IPC. They must
    // be treated as "not set", not rejected — rejecting them broke every
    // manual save in the real app (caught by window-close-guard.spec.ts).
    expect(() =>
      assertSaveFileOptions({ forceOnErrors: undefined, overwriteExternal: undefined })
    ).not.toThrow();
    expect(() =>
      assertSaveFileOptions({ forceOnErrors: undefined, overwriteExternal: true })
    ).not.toThrow();
  });

  it('rejects a non-boolean value for a known key', () => {
    expect(() => assertSaveFileOptions({ skipValidation: 'yes' })).toThrow(/option/i);
  });

  it('accepts a well-formed existingVoiceIds map (and undefined)', () => {
    expect(() =>
      assertSaveFileOptions({
        existingVoiceIds: {
          DIA_ALRIK_HALLO_15_00: [{ filePath: '/mod/DIA_Alrik.d', functionName: 'DIA_Alrik_Hallo_Info' }]
        }
      })
    ).not.toThrow();
    expect(() => assertSaveFileOptions({ existingVoiceIds: undefined })).not.toThrow();
  });

  it('rejects a malformed existingVoiceIds value', () => {
    expect(() => assertSaveFileOptions({ existingVoiceIds: true })).toThrow(/existingVoiceIds/i);
    expect(() =>
      assertSaveFileOptions({ existingVoiceIds: { DIA_X_15_00: [{ filePath: 42 }] } })
    ).toThrow(/existingVoiceIds/i);
  });

  it('rejects a non-object', () => {
    expect(() => assertSaveFileOptions('x')).toThrow(/option/i);
  });
});

describe('sanitizeRendererErrorPayload', () => {
  it('accepts a well-formed payload with message only', () => {
    expect(sanitizeRendererErrorPayload({ message: 'boom' })).toEqual({ message: 'boom' });
  });

  it('accepts a well-formed payload with message and stack', () => {
    expect(sanitizeRendererErrorPayload({ message: 'boom', stack: 'at foo' })).toEqual({
      message: 'boom',
      stack: 'at foo',
    });
  });

  it('drops a non-object payload', () => {
    expect(sanitizeRendererErrorPayload('boom')).toBeNull();
    expect(sanitizeRendererErrorPayload(null)).toBeNull();
    expect(sanitizeRendererErrorPayload(42)).toBeNull();
    expect(sanitizeRendererErrorPayload([])).toBeNull();
  });

  it('drops a payload whose message is not a string', () => {
    expect(sanitizeRendererErrorPayload({ message: 42 })).toBeNull();
    expect(sanitizeRendererErrorPayload({ message: { nested: true } })).toBeNull();
    expect(sanitizeRendererErrorPayload({})).toBeNull();
  });

  it('drops a payload with an empty message', () => {
    expect(sanitizeRendererErrorPayload({ message: '' })).toBeNull();
  });

  it('drops a payload whose message exceeds the cap', () => {
    const oversized = 'x'.repeat(RENDERER_ERROR_MESSAGE_MAX + 1);
    expect(sanitizeRendererErrorPayload({ message: oversized })).toBeNull();
  });

  it('accepts a message exactly at the cap', () => {
    const atCap = 'x'.repeat(RENDERER_ERROR_MESSAGE_MAX);
    expect(sanitizeRendererErrorPayload({ message: atCap })).toEqual({ message: atCap });
  });

  it('drops a payload whose stack is not a string', () => {
    expect(sanitizeRendererErrorPayload({ message: 'boom', stack: 42 })).toBeNull();
  });

  it('drops a payload whose stack exceeds the cap', () => {
    const oversized = 'y'.repeat(RENDERER_ERROR_STACK_MAX + 1);
    expect(sanitizeRendererErrorPayload({ message: 'boom', stack: oversized })).toBeNull();
  });
});

describe('assertOpenWorldRequest', () => {
  const valid = {
    worldPath: 'C:/Gothic II/_work/Data/Worlds/NewWorld/NewWorld.zen',
    gameVersion: 'g2',
    assetSources: ['C:/Gothic II/Data/Meshes.vdf'],
  };

  it('accepts a well-formed request', () => {
    expect(() => assertOpenWorldRequest(valid)).not.toThrow();
  });

  it('rejects a game version that is not one of the three targets', () => {
    // The target version is explicit and never guessed (level-editor.md §9) —
    // `World::save` takes it as a mandatory parameter, so a wrong one here is
    // a wrong file later.
    expect(() => assertOpenWorldRequest({ ...valid, gameVersion: 'g3' })).toThrow(/gameVersion/);
    expect(() => assertOpenWorldRequest({ ...valid, gameVersion: undefined })).toThrow(/gameVersion/);
  });

  it('rejects a non-string world path', () => {
    expect(() => assertOpenWorldRequest({ ...valid, worldPath: 42 })).toThrow(/worldPath/);
  });

  it('rejects asset sources that are not a string array', () => {
    // Every entry is path-validated by the caller; one non-string would slip
    // through the loop untouched and be handed to the VFS.
    expect(() => assertOpenWorldRequest({ ...valid, assetSources: 'Meshes.vdf' })).toThrow(/assetSources/);
    expect(() => assertOpenWorldRequest({ ...valid, assetSources: ['ok', 7] })).toThrow(/assetSources/);
  });

  it('accepts an empty asset source list', () => {
    // An install with neither archives nor loose trees is a real state, and
    // it is the renderer's job to report it, not this validator's.
    expect(() => assertOpenWorldRequest({ ...valid, assetSources: [] })).not.toThrow();
  });

  it('rejects a non-object payload', () => {
    expect(() => assertOpenWorldRequest(null)).toThrow();
    expect(() => assertOpenWorldRequest([valid])).toThrow();
  });
});

describe('assertTextureRequest', () => {
  it('accepts a name and a positive size', () => {
    expect(() => assertTextureRequest({ name: 'NW_WOOD.TGA', maxSize: 256 })).not.toThrow();
  });

  it('rejects a non-string name', () => {
    expect(() => assertTextureRequest({ name: 42, maxSize: 256 })).toThrow(/texture name/i);
  });

  it('rejects a size that is not a positive integer', () => {
    // maxSize picks a mipmap level in a loop; a zero, a negative or a NaN
    // makes that loop's exit condition meaningless.
    for (const bad of [0, -1, 1.5, NaN, Infinity, '256']) {
      expect(() => assertTextureRequest({ name: 'NW_WOOD.TGA', maxSize: bad })).toThrow(/maxSize/);
    }
  });
});
