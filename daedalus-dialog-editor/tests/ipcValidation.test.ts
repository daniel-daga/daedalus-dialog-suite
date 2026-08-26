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
  assertApplyOpsRequest,
  assertSaveWorldRequest,
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

describe('assertSaveWorldRequest', () => {
  it('accepts a target path', () => {
    expect(() => assertSaveWorldRequest({ targetPath: 'C:/Gothic/NewWorld.edited.zen' })).not.toThrow();
  });

  it('rejects anything that is not a non-empty string', () => {
    // It reaches the native writer, which creates a temp file beside it and
    // renames. The whitelist check in main is the other half; this is the shape.
    for (const bad of ['', '   ', null, 42, ['a'], undefined]) {
      expect(() => assertSaveWorldRequest({ targetPath: bad })).toThrow(/targetPath/);
    }
    expect(() => assertSaveWorldRequest(null)).toThrow();
    expect(() => assertSaveWorldRequest('C:/a.zen')).toThrow();
  });
});

describe('assertApplyOpsRequest', () => {
  const move = {
    op: 'MoveVob',
    vob: 3,
    path: '0/4',
    from: [10, 20, 30],
    to: [11, 20, 30],
  };

  it('accepts a well-formed batch', () => {
    expect(() => assertApplyOpsRequest({ ops: [move] })).not.toThrow();
  });

  it('accepts an empty batch', () => {
    // A drag that ended where it began sends nothing to move, and refusing it
    // here would make the caller special-case a no-op.
    expect(() => assertApplyOpsRequest({ ops: [] })).not.toThrow();
  });

  it('rejects an op it has never heard of', () => {
    // §7 lists reparent, set-prop, add and delete as ops to come. Until the
    // binding can apply one, naming it here is the difference between 'not
    // implemented' and a silently ignored edit.
    expect(() => assertApplyOpsRequest({ ops: [{ ...move, op: 'DeleteVob' }] })).toThrow(/DeleteVob/);
  });

  it('rejects an index path that is not slots separated by slashes', () => {
    // It goes straight to setVobPosition, which parses it in C++ and addresses
    // the VOB tree with it.
    for (const bad of ['', '/', '0//2', 'a/b', '0/2/', -1, null]) {
      expect(() => assertApplyOpsRequest({ ops: [{ ...move, path: bad }] })).toThrow(/path/);
    }
  });

  it('rejects positions that are not three finite numbers', () => {
    for (const bad of [[1, 2], [1, 2, 3, 4], [1, 2, 'x'], [1, 2, NaN], [1, 2, Infinity], null, '1,2,3']) {
      expect(() => assertApplyOpsRequest({ ops: [{ ...move, to: bad }] })).toThrow(/to/);
      expect(() => assertApplyOpsRequest({ ops: [{ ...move, from: bad }] })).toThrow(/from/);
    }
  });

  it('rejects a vob that is not a non-negative integer', () => {
    for (const bad of [-1, 1.5, '3', NaN]) {
      expect(() => assertApplyOpsRequest({ ops: [{ ...move, vob: bad }] })).toThrow(/vob/);
    }
  });

  it('rejects a payload that is not a batch at all', () => {
    expect(() => assertApplyOpsRequest(null)).toThrow();
    expect(() => assertApplyOpsRequest({ ops: move })).toThrow(/ops/);
    expect(() => assertApplyOpsRequest([move])).toThrow();
  });

  describe('a rotation', () => {
    const rotate = {
      op: 'RotateVob',
      vob: 3,
      path: '0/4',
      from: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      to: [0, 0, 1, 0, 1, 0, -1, 0, 0],
      fromBbox: [-1, -1, -1, 1, 1, 1],
      toBbox: [-2, -1, -1, 2, 1, 1],
    };

    it('is accepted, matrices and boxes and all', () => {
      expect(() => assertApplyOpsRequest({ ops: [rotate] })).not.toThrow();
    });

    it('is accepted with no boxes — an unresolved visual has none', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...rotate, fromBbox: null, toBbox: null }],
      })).not.toThrow();
    });

    it('mixes with moves in one batch', () => {
      expect(() => assertApplyOpsRequest({ ops: [move, rotate] })).not.toThrow();
    });

    it('rejects a matrix that is not nine finite numbers', () => {
      // It is handed to native code and read positionally: a short matrix would
      // leave uninitialized rows in a struct ZenKit does not zero.
      for (const bad of [[1, 2, 3], new Array(8).fill(0), new Array(10).fill(0),
        [...new Array(8).fill(0), NaN], null, '1,0,0']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...rotate, to: bad }] })).toThrow(/to/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...rotate, from: bad }] })).toThrow(/from/);
      }
    });

    it('rejects a box that is not six finite numbers, but takes null', () => {
      for (const bad of [[1, 2, 3], new Array(7).fill(0), [1, 2, 3, 4, 5, Infinity], '0']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...rotate, toBbox: bad }] })).toThrow(/Bbox/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...rotate, fromBbox: bad }] })).toThrow(/Bbox/);
      }
    });

    it('rejects a rotation carrying a position where a matrix belongs', () => {
      // The two ops share every other field name, so a `MoveVob` mislabelled as
      // a rotation is exactly the shape that would slip through a check that
      // only looked at `op`.
      expect(() => assertApplyOpsRequest({ ops: [{ ...rotate, to: [1, 2, 3] }] })).toThrow(/to/);
    });
  });

  describe('a property change', () => {
    const props = {
      op: 'SetVobProp',
      vob: 3,
      path: '0/4',
      from: { name: 'BARREL_01', showVisual: true },
      to: { name: 'BARREL_02', showVisual: false },
      fromBbox: null,
      toBbox: null,
    };

    it('is accepted, and mixes with a move in one batch', () => {
      expect(() => assertApplyOpsRequest({ ops: [props] })).not.toThrow();
      expect(() => assertApplyOpsRequest({ ops: [move, props] })).not.toThrow();
    });

    it('rejects a property the binding has never heard of', () => {
      // The props object is handed to C++ whole, where an unrecognised key is
      // refused rather than ignored — so refusing it here is what keeps a
      // mistyped key from being discovered at the bottom of a batch that has
      // already applied half of itself.
      for (const bad of [{ showvisual: true }, { position: [1, 2, 3] }, { scale: 2 }]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...props, from: bad, to: bad }],
        })).toThrow(/unknown property/);
      }
    });

    it('rejects a property whose value is the wrong type', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, from: { name: 1 }, to: { name: 2 } }],
      })).toThrow(/name/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, from: { showVisual: 'yes' }, to: { showVisual: 'no' } }],
      })).toThrow(/showVisual/);
    });

    it('rejects sides that do not carry the same properties', () => {
      // The inverse is `from` and `to` swapped. Sides that disagree give an
      // undo that restores a different set of fields than the op wrote, and
      // nothing shows it until somebody presses Ctrl+Z.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, from: { name: 'A' }, to: { name: 'B', showVisual: true } }],
      })).toThrow(/same properties/);
    });

    it('rejects an op that sets nothing', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, from: {}, to: {} }],
      })).toThrow(/sets no properties/);
    });

    it('takes a box only for a change of visual', () => {
      const box = [-1, -1, -1, 1, 1, 1];
      expect(() => assertApplyOpsRequest({
        ops: [{
          ...props,
          from: { visual: 'A.3DS' }, to: { visual: 'B.3DS' },
          fromBbox: box, toBbox: box,
        }],
      })).not.toThrow();
      // Nothing but a visual swap can move the box, and the binding refuses one
      // that no swap justifies — so a batch carrying it never starts.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, toBbox: box }],
      })).toThrow(/visual/);
    });

    it('rejects a box that is not six finite numbers', () => {
      const visual = { ...props, from: { visual: 'A.3DS' }, to: { visual: 'B.3DS' } };
      for (const bad of [[1, 2, 3], new Array(7).fill(0), [1, 2, 3, 4, 5, NaN], '0']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...visual, toBbox: bad }] })).toThrow(/Bbox/);
      }
    });

    it('rejects sides that are not objects at all', () => {
      for (const bad of [null, 'name', 42, ['name']]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...props, from: bad, to: bad }],
        })).toThrow(/from|to/);
      }
    });
  });

  describe('an add', () => {
    const add = {
      op: 'AddVob',
      vob: 12,
      path: '3',
      from: null,
      to: { name: 'PLACED', visual: 'CRATE.3DS', position: [1, 2, 3] },
    };

    it('is accepted in either direction', () => {
      expect(() => assertApplyOpsRequest({ ops: [add] })).not.toThrow();
      // Its inverse: the same op with the sides swapped, which is a delete.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, from: add.to, to: null }],
      })).not.toThrow();
    });

    it('rejects an op that is neither an add nor a delete', () => {
      // Both null does nothing; neither null is an add and a delete at once,
      // and `writeOp` would then read it as an insert in *both* directions — so
      // the VOB would never come back off an undo.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, from: null, to: null }],
      })).toThrow(/one null side/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, from: add.to, to: add.to }],
      })).toThrow(/one null side/);
    });

    it('requires a position, in three finite numbers', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { name: 'NO_WHERE' } }],
      })).toThrow(/position/);
      for (const bad of [[1, 2], [1, 2, NaN], '1,2,3', null]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...add, to: { position: bad } }],
        })).toThrow(/position/);
      }
    });

    it('rejects a property the binding cannot author', () => {
      // `physicsEnabled` is in the flag word the property op writes, and
      // `insertVob` does not take it — ZenGin writes that field only for some
      // world formats and cannot set it in the Spacer at all. Sharing one list
      // between the two would wave through exactly what the binding refuses.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], physicsEnabled: true } }],
      })).toThrow(/physicsEnabled/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], scale: 2 } }],
      })).toThrow(/scale/);
    });

    it('checks the matrix and the box it is given', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], rotation: [1, 2, 3] } }],
      })).toThrow(/rotation/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], bbox: [1, 2, 3] } }],
      })).toThrow(/bbox/);
    });
  });
});
