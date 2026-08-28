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
  assertVobPropsRequest,
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

describe('assertVobPropsRequest', () => {
  it('accepts a slot path', () => {
    expect(() => assertVobPropsRequest({ path: '0' })).not.toThrow();
    expect(() => assertVobPropsRequest({ path: '0/4/12' })).not.toThrow();
  });

  it('rejects anything that is not slot indices', () => {
    // A read, but the path is parsed in C++ and walks the VOB tree, so it is
    // held to the same shape the ops are rather than left to ParseIndexPath.
    for (const bad of ['', '/0', '0/', 'a', '0//1', '-1', 0, null, undefined, ['0']]) {
      expect(() => assertVobPropsRequest({ path: bad })).toThrow(/path/i);
    }
    expect(() => assertVobPropsRequest('0/4')).toThrow(/plain object/i);
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

    it('takes the three base fields, bounded by the packed vob layout', () => {
      // `visualCamAlign` is two bits and `bias` five in the packed `zCVob`
      // layout, so a wider number is written truncated and reported as written.
      // 3 is one past `SpriteAlignment`'s three named values and is taken:
      // 7 retail VOBs hold it, and the inverse of an edit on one writes it back.
      expect(() => assertApplyOpsRequest({
        ops: [{
          ...props,
          from: { presetName: 'FIRE_STAT', visualCamAlign: 3, bias: 0 },
          to: { presetName: '', visualCamAlign: 1, bias: 31 },
        }],
      })).not.toThrow();

      for (const bad of [32, -1, 1.5, '2', null]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...props, from: { bias: 0 }, to: { bias: bad } }],
        })).toThrow(/bias/);
      }
      for (const bad of [4, -1, 0.5, 'full']) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...props, from: { visualCamAlign: 0 }, to: { visualCamAlign: bad } }],
        })).toThrow(/visualCamAlign/);
      }
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, from: { presetName: 1 }, to: { presetName: 'X' } }],
      })).toThrow(/presetName/);
    });

    it('takes dynamicShadows on the same two bits', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...props, from: { dynamicShadows: 0 }, to: { dynamicShadows: 1 } }],
      })).not.toThrow();
      for (const bad of [4, -1, 0.5, '1', null]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...props, from: { dynamicShadows: 0 }, to: { dynamicShadows: bad } }],
        })).toThrow(/dynamicShadows/);
      }
    });

    it('takes the seven decal fields, bounded by what the archive holds', () => {
      // Whether the VOB *has* a decal is not knowable here — the main process
      // holds no world of its own — so this layer checks the shape and the
      // binding makes the per-VOB refusal. The op builder refuses it earlier
      // still, on a `getVobProps` read that answered `decal: null`.
      expect(() => assertApplyOpsRequest({
        ops: [{
          ...props,
          from: {
            decalDimension: [40, 40], decalOffset: [0, 0], decalTwoSided: true,
            decalAlphaFunc: 2, decalTextureAnimFps: 0, decalAlphaWeight: 200,
            decalIgnoreDaylight: false,
          },
          to: {
            decalDimension: [55, 65], decalOffset: [-3, 7], decalTwoSided: false,
            decalAlphaFunc: 6, decalTextureAnimFps: 9.5, decalAlphaWeight: 128,
            decalIgnoreDaylight: true,
          },
        }],
      })).not.toThrow();

      const bad: Record<string, unknown[]> = {
        decalDimension: [[1], [1, 2, 3], 'x', [1, NaN], null, [-1, 0]],
        decalOffset: [[], [0, 0, 0], 5, [Infinity, 0]],
        decalAlphaFunc: [7, -1, 1.5, '2'],
        decalAlphaWeight: [256, -1, 0.5, '80'],
        decalTextureAnimFps: [-1, Infinity, '9'],
        decalTwoSided: [1, 'true', null],
        decalIgnoreDaylight: [0, 'false'],
      };
      for (const [key, values] of Object.entries(bad)) {
        for (const value of values) {
          expect(() => assertApplyOpsRequest({
            ops: [{ ...props, from: { [key]: value }, to: { [key]: value } }],
          })).toThrow(new RegExp(key));
        }
      }
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

    it('still takes all eight base keys at once', () => {
      // The regression the class-property branch next door could break: the two
      // ops share `from`/`to` names and differ only by `op`, so a branch that
      // caught the wrong one would refuse every base edit in the app.
      const all = {
        name: 'BARREL', visual: 'BARREL.3DS', showVisual: true, vobStatic: true,
        ambient: false, cdStatic: true, cdDynamic: false, physicsEnabled: true,
      };
      expect(() => assertApplyOpsRequest({ ops: [{ ...props, from: all, to: all }] }))
        .not.toThrow();
    });
  });

  describe('a class property change', () => {
    // The first op whose legal key set depends on *which VOB it addresses*. The
    // validator has no world and no index, so `className` is the only thing that
    // makes a key legal here — a declaration of intent the binding re-checks
    // against the VOB's real type.
    const instance = {
      op: 'SetVobClassProp',
      vob: 3,
      path: '0/4',
      className: 'oCItem',
      from: { instance: 'ITMW_1H_SWORD_01' },
      to: { instance: 'ITMW_2H_AXE_01' },
    };
    const light = {
      op: 'SetVobClassProp',
      vob: 7,
      path: '0/9',
      className: 'zCVobLight',
      from: { range: 1500, color: [255, 240, 200, 255] },
      to: { range: 2000, color: [200, 200, 255, 255] },
    };

    // Increment 2's classes: the sound family and the zones. Each is one
    // catalogue entry away from the two above, and this validator reads the
    // catalogue — so what these cases actually pin is that the entry is *there*,
    // which is the half of the change that `assertApplyOpsRequest` is famous for
    // being shipped without (`ReparentVob`).
    const sound = {
      op: 'SetVobClassProp',
      vob: 11,
      path: '0/12',
      className: 'zCVobSound',
      from: { soundName: 'OW_CRICKET', volume: 50, radius: 1500, coneAngle: 0 },
      to: { soundName: 'OW_OWL', volume: 80, radius: 2500, coneAngle: 90 },
    };
    const daytime = {
      ...sound,
      className: 'zCVobSoundDaytime',
      from: { ...sound.from, startTime: 6, endTime: 20, soundName2: 'OW_OWL_NIGHT' },
      to: { ...sound.to, startTime: 8, endTime: 18, soundName2: 'OW_WOLF_NIGHT' },
    };
    const fog = {
      op: 'SetVobClassProp',
      vob: 12,
      path: '0/13',
      className: 'zCZoneZFog',
      from: { rangeCenter: 12000, innerRangePercentage: 0.5, color: [120, 130, 140, 255] },
      to: { rangeCenter: 9000, innerRangePercentage: 0.25, color: [10, 20, 30, 255] },
    };
    const farPlane = {
      op: 'SetVobClassProp',
      vob: 13,
      path: '0/14',
      className: 'zCZoneVobFarPlane',
      from: { vobFarPlaneZ: 8000, innerRangePercentage: 0.75 },
      to: { vobFarPlaneZ: 12000, innerRangePercentage: 0.5 },
    };
    const music = {
      op: 'SetVobClassProp',
      vob: 14,
      path: '0/15',
      className: 'oCZoneMusic',
      from: { reverb: -30, volume: 0.5 },
      to: { reverb: -10, volume: 0.9 },
    };

    it('accepts an item instance and a light', () => {
      expect(() => assertApplyOpsRequest({ ops: [instance] })).not.toThrow();
      expect(() => assertApplyOpsRequest({ ops: [light] })).not.toThrow();
    });

    it('accepts the sound family and the three zones', () => {
      for (const op of [sound, daytime, fog, farPlane, music]) {
        expect(() => assertApplyOpsRequest({ ops: [op] })).not.toThrow();
      }
    });

    it('refuses an item instance that is not the shape of a Daedalus symbol', () => {
      // `oCItem.instance` is the one class field whose value is a *name in
      // another file*, and ZenGin crashes on one no script declares
      // (level-editor.md §14.1). *Which* names exist is not a question this
      // process can answer — it holds no item index — so what it refuses is the
      // shape: anything that could not be a Daedalus symbol could not be an
      // instance either, whatever scripts are loaded.
      for (const bad of ['ITMW 1H SWORD', '', '1SWORD', 'ITMW-1H', 'ITMW_1H_SWORD_01\n', '"X"']) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...instance, from: { instance: 'ITMW_1H_SWORD_01' }, to: { instance: bad } }],
        })).toThrow(/to\.instance must be a Daedalus instance name/);
      }
      // A leading underscore is legal Daedalus, and so is a name with no digits.
      for (const good of ['_HIDDEN_ITEM', 'ItMw_1h_Sword_01', 'X']) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...instance, from: { instance: 'ITMW_1H_SWORD_01' }, to: { instance: good } }],
        })).not.toThrow();
      }
    });

    it('takes an op that repairs an instance the world already holds', () => {
      // `to` is checked and `from` deliberately is not. `from` is the value the
      // world *has*, and a third-party or hand-edited world is free to hold
      // something the shape check refuses — refusing it here would block the one
      // edit that repairs it, and would block the undo of an edit that has
      // already applied.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...instance, from: { instance: '' }, to: { instance: 'ITMW_2H_AXE_01' } }],
      })).not.toThrow();
    });

    it('leaves every other class string alone', () => {
      // The shape check is `oCItem.instance` and nothing else. A sound name is a
      // file name in the VFS, not a symbol, and refusing a dot or a space in one
      // would refuse retail data.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...sound, from: { soundName: 'OW_CRICKET' }, to: { soundName: 'OW CRICKET.WAV' } }],
      })).not.toThrow();
    });

    it('accepts a base sound field on a daytime sound, and refuses it the other way', () => {
      // The inheritance, at the layer that decides legality. `zCVobSoundDaytime`
      // derives from `zCVobSound`, so `radius` is legal on both — while
      // `startTime` is legal only on the derived one, and a catalogue that
      // flattened the two would let it through on a plain sound the binding
      // would then refuse mid-batch.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...daytime, from: { radius: 1500 }, to: { radius: 2500 } }],
      })).not.toThrow();
      expect(() => assertApplyOpsRequest({
        ops: [{ ...sound, from: { startTime: 6 }, to: { startTime: 8 } }],
      })).toThrow(/zCVobSound has no class property startTime/);
    });

    it('refuses a zone field on the wrong zone', () => {
      // The three zones are three unrelated classes that read like one family,
      // which is exactly the mistake this op carries a `className` to catch.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...farPlane, from: { rangeCenter: 1 }, to: { rangeCenter: 2 } }],
      })).toThrow(/zCZoneVobFarPlane has no class property rangeCenter/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...fog, from: { vobFarPlaneZ: 1 }, to: { vobFarPlaneZ: 2 } }],
      })).toThrow(/zCZoneZFog has no class property vobFarPlaneZ/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { color: [0, 0, 0, 255] }, to: { color: [1, 1, 1, 255] } }],
      })).toThrow(/oCZoneMusic has no class property color/);
    });

    it('refuses a negative sound volume, a daytime hour outside 0-24, and an inner range above 1', () => {
      // All bounds are the catalogue's. `startTime`/`endTime` are hours of the
      // day — 24 is a bound and not a modulus, so a caller meaning midnight
      // means 0.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...sound, from: { volume: 50 }, to: { volume: -1 } }],
      })).toThrow(/to\.volume must be 0 or greater/);
      // No maximum on the volume: retail NewWorld holds 130 and 150 (measured
      // 2026-08-27), so ZenKit's "percent (0-100)" doc is wrong against the
      // game's own data and a max of 100 would refuse it.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...sound, from: { volume: 50 }, to: { volume: 150 } }],
      })).not.toThrow();
      expect(() => assertApplyOpsRequest({
        ops: [{ ...daytime, from: { endTime: 20 }, to: { endTime: 24.5 } }],
      })).toThrow(/to\.endTime must be 24 or less/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...sound, from: { coneAngle: 0 }, to: { coneAngle: 361 } }],
      })).toThrow(/to\.coneAngle must be 360 or less/);
      // `innerRangePercentage` is stored 0..1, not 0..100 — measured over the
      // three retail worlds (every value in [0.1, 1.0], the `…Default` zones
      // exactly 1.0), where ZenKit's docs say "Unknown".
      expect(() => assertApplyOpsRequest({
        ops: [{ ...fog, from: { innerRangePercentage: 0.5 }, to: { innerRangePercentage: 1.5 } }],
      })).toThrow(/to\.innerRangePercentage must be 1 or less/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...farPlane, from: { innerRangePercentage: 0.5 }, to: { innerRangePercentage: 1.5 } }],
      })).toThrow(/to\.innerRangePercentage must be 1 or less/);
    });

    it('accepts the booleans and the one integer, and refuses each as the other kind', () => {
      // The two kinds increment 3 exists for, at the layer every other test
      // mocks past. A `bool` that arrives as `0` and an `int` that arrives as
      // `1.5` are the exact mistakes they are here to stop: a truthy number
      // coerced into a byte nobody chose, and a fraction truncated on the cast
      // to `int32_t` at the bottom of a batch that has already applied.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...sound, from: { obstruction: true }, to: { obstruction: false } }],
      })).not.toThrow();
      expect(() => assertApplyOpsRequest({
        ops: [{ ...fog, from: { overrideColor: false }, to: { overrideColor: true } }],
      })).not.toThrow();
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { priority: 2 }, to: { priority: 7 } }],
      })).not.toThrow();
      // Zero is a priority and `false` is a value, so neither may be refused for
      // being falsy — the mistake a `!value` check makes.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { enabled: true, priority: 3 }, to: { enabled: false, priority: 0 } }],
      })).not.toThrow();

      for (const bad of [0, 1, 'true', null, [], 1.5]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...sound, from: { ambient3d: false }, to: { ambient3d: bad } }],
        })).toThrow(/to\.ambient3d must be true or false/);
      }
      for (const bad of [1.5, -0.5, true, '3', NaN, Infinity]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...music, from: { priority: 1 }, to: { priority: bad } }],
        })).toThrow(/to\.priority must be a whole number/);
      }
      // The bound is the catalogue's, and it is separate from the whole-number
      // check: -1 is an integer and still refused.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { priority: 1 }, to: { priority: -1 } }],
      })).toThrow(/to\.priority must be 0 or greater/);
      // Both sides are walked, so an inverse an undo would write is refused too.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { priority: 1.5 }, to: { priority: 2 } }],
      })).toThrow(/from\.priority must be a whole number/);
    });

    it('accepts a negative music reverb, which is the whole reason it has no bound', () => {
      // ZenGin's reverb level is negative decibels. A `min: 0` copied from the
      // light's range would refuse every music zone in a retail world.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { reverb: -100 }, to: { reverb: -0.5 } }],
      })).not.toThrow();
      // …and it is still a number.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...music, from: { reverb: -100 }, to: { reverb: '-1' } }],
      })).toThrow(/to\.reverb must be a finite number/);
    });

    it('refuses a sound name that is not a string, and a fog colour that is not four channels', () => {
      for (const bad of [42, null, ['OW'], true]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...sound, from: { soundName: 'OW_CRICKET' }, to: { soundName: bad } }],
        })).toThrow(/to\.soundName must be a string/);
      }
      for (const bad of [[120, 130, 140], [120, 130, 140, 256], [120, 130, 140.5, 255], 'grey']) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...fog, from: { color: [0, 0, 0, 255] }, to: { color: bad } }],
        })).toThrow(/to\.color must be four whole channels/);
      }
    });

    it('accepts one key of a class that has two', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...light, from: { range: 1500 }, to: { range: 2000 } }],
      })).not.toThrow();
    });

    it('mixes with a move and an old-style property change in one batch', () => {
      // Neither structural nor renumbering, so a class edit batches with the
      // base edit the same grid emits — and the validator must not be the layer
      // that decides otherwise.
      const base = {
        op: 'SetVobProp', vob: 7, path: '0/9',
        from: { showVisual: true }, to: { showVisual: false },
        fromBbox: null, toBbox: null,
      };
      expect(() => assertApplyOpsRequest({ ops: [move, base, light] })).not.toThrow();
    });

    it('rejects a key that belongs to another class', () => {
      // The whole reason the op carries a class: without it `{ range: 500 }` on
      // an item would be discovered in C++ at the bottom of a batch that has
      // already applied half of itself.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...instance, from: { range: 500 }, to: { range: 900 } }],
      })).toThrow(/oCItem has no class property range/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...light, from: { instance: 'A' }, to: { instance: 'B' } }],
      })).toThrow(/zCVobLight has no class property instance/);
    });

    it('rejects a class the catalogue does not know', () => {
      // A world has 37 classes and the catalogue has fewer. With no entry there is
      // no key the op could legally carry, so the refusal is the class itself
      // rather than every key of it in turn.
      for (const bad of ['oCMobBed', 'zCVob', '', 'toString', 42, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...instance, className: bad }] }))
          .toThrow(/no class properties are known/);
      }
    });

    it('rejects className smuggled in as a property key', () => {
      // It is a top-level field of the op, and a key of that name in `from`/`to`
      // would be a props object shaped to look like one the binding writes.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...instance, from: { className: 'oCItem' }, to: { className: 'zCVobLight' } }],
      })).toThrow(/no class property className/);
    });

    it('rejects an instance that is not a string', () => {
      for (const bad of [42, null, ['A'], { name: 'A' }, true]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...instance, from: { instance: 'A' }, to: { instance: bad } }],
        })).toThrow(/to\.instance must be a string/);
      }
    });

    it('rejects a range that is not a finite number', () => {
      for (const bad of [NaN, Infinity, '1500', null, [1500]]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...light, from: { range: 1 }, to: { range: bad } }],
        })).toThrow(/to\.range must be a finite number/);
      }
    });

    it('rejects a negative range', () => {
      // The bound is the catalogue's, not this file's: a light with a negative
      // range is a light ZenGin renders as nothing at all.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...light, from: { range: 1 }, to: { range: -1 } }],
      })).toThrow(/to\.range must be 0 or greater/);
    });

    it('rejects a colour that is not four whole channels in range', () => {
      // Fixed arity, because the binding reads it positionally as r, g, b and
      // the alpha ZenGin keeps — a three-element colour would leave one channel
      // to whatever the struct happened to hold.
      for (const bad of [[255, 240, 200], [255, 240, 200, 255, 0], [255, 240, 200, 256],
        [-1, 0, 0, 255], [255, 240, 200.5, 255], [255, 240, '200', 255], null, 255]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...light, from: { color: [0, 0, 0, 255] }, to: { color: bad } }],
        })).toThrow(/to\.color must be four whole channels/);
      }
    });

    it('rejects sides that do not carry the same class properties', () => {
      // The inverse is `from` and `to` swapped, so sides that disagree give an
      // undo that restores a different set of fields than the op wrote.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...light, from: { range: 1500 }, to: { range: 2000, color: [0, 0, 0, 255] } }],
      })).toThrow(/same class properties/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...light, from: { color: [0, 0, 0, 255] }, to: { range: 2000 } }],
      })).toThrow(/same class properties/);
    });

    it('rejects an op that sets nothing', () => {
      expect(() => assertApplyOpsRequest({ ops: [{ ...instance, from: {}, to: {} }] }))
        .toThrow(/sets no class properties/);
    });

    it('rejects sides that are not objects at all', () => {
      for (const bad of [null, 'instance', 42, ['instance']]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...instance, from: bad, to: bad }] }))
          .toThrow(/from|to/);
      }
    });

    it('rejects a vob or a path that is not an address', () => {
      for (const bad of [-1, 1.5, '3', NaN]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...instance, vob: bad }] })).toThrow(/vob/);
      }
      for (const bad of ['', '/', '0//2', 'a/b', '0/4/', 3, null]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...instance, path: bad }] })).toThrow(/path/);
      }
    });

    it('rejects anything beyond the six fields it carries', () => {
      // No field in this slice can move the culling box, so a `fromBbox` on one
      // is either a `SetVobProp` mislabelled or a caller assuming a box gets
      // refitted — and both are quieter as a refusal than as a field the writer
      // drops on the floor.
      for (const extra of ['fromBbox', 'toBbox', 'parentPath', 'name']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...instance, [extra]: null }] }))
          .toThrow(new RegExp(extra));
      }
    });
  });

  describe('an add', () => {
    const add = {
      op: 'AddVob',
      vob: 12,
      path: '3',
      parentPath: null,
      from: null,
      to: { name: 'PLACED', visual: 'CRATE.3DS', position: [1, 2, 3] },
    };

    it('is accepted under a parent as well as at the roots', () => {
      // `parentPath` reaches C++ and walks the VOB tree, exactly as an op's
      // `path` does — so it is checked in the same shape and not merely for
      // being a string.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, path: '2/1', parentPath: '2' }],
      })).not.toThrow();
      for (const bad of ['', '/', '0//2', 'a/b', '0/2/', 3, undefined]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...add, parentPath: bad }],
        })).toThrow(/parentPath/);
      }
    });

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

    it('takes a class the binding can author, and refuses one it cannot', () => {
      // The class is the object's C++ type and the binding's set of
      // constructions is closed (level-editor.md §16.15, I1), so a class it has
      // no construction for cannot be authored as a `zCVob` wearing the name —
      // `setVobClassProp` would then refuse every property of it.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], class: 'zCVob' } }],
      })).not.toThrow();
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], class: 'oCItem', instance: 'ITFO_APPLE' } }],
      })).not.toThrow();
      // The lights and the sounds (I2) and the trigger family (I3), none of
      // which takes an instance or needs one.
      for (const className of [
        'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime',
        'zCTrigger', 'zCTriggerList', 'oCTriggerScript', 'oCTriggerChangeLevel',
        'zCMover', 'zCCodeMaster', 'zCMessageFilter',
      ]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...add, to: { position: [0, 0, 0], class: className } }],
        })).not.toThrow();
        expect(() => assertApplyOpsRequest({
          ops: [{ ...add, to: { position: [0, 0, 0], class: className, instance: 'ITFO_APPLE' } }],
        })).toThrow(/instance/);
      }
      // `zCTriggerScript` is the pointed one since I3: that class *is*
      // authorable and the archive spells it `oCTriggerScript`, so the spoken
      // name is still one the binding has no construction for.
      for (const bad of ['oCMobDoor', 'zCTriggerScript', 'ocitem', '', 7, null]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...add, to: { position: [0, 0, 0], class: bad } }],
        })).toThrow(/class/);
      }
    });

    it('pairs the instance with the one class that has one', () => {
      // An `instance` on any other class is a mistake about the class, and an
      // `oCItem` without one spawns nothing the engine can resolve. Both are
      // shape, so both hold here — unlike whether the scripts declare the name,
      // which only the renderer can answer.
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], instance: 'ITFO_APPLE' } }],
      })).toThrow(/instance/);
      expect(() => assertApplyOpsRequest({
        ops: [{ ...add, to: { position: [0, 0, 0], class: 'oCItem' } }],
      })).toThrow(/instance/);
    });

    it('refuses an instance that could not be a Daedalus symbol', () => {
      // The strongest statement a process with no semantic model can make, and
      // the same one `SetVobClassProp` already makes — the main process holds no
      // item index and a world may be edited with no script project open.
      for (const bad of ['1TFO', 'IT FO', 'ITFO-APPLE', '', 7]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...add, to: { position: [0, 0, 0], class: 'oCItem', instance: bad } }],
        })).toThrow(/instance/);
      }
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

  describe('a reparent', () => {
    // The op the scene tree's drag and drop sends. It is the first op with no
    // top-level `path` — a move has two ends and carries one on each side — and
    // that is exactly what a validator written around `op.path` refuses.
    const reparent = {
      op: 'ReparentVob',
      vob: 5,
      from: { path: '2/1', parentPath: '2', slot: 1 },
      to: { path: '7/0', parentPath: '7', slot: 0 },
    };

    it('is accepted, and so is its inverse', () => {
      expect(() => assertApplyOpsRequest({ ops: [reparent] })).not.toThrow();
      expect(() => assertApplyOpsRequest({
        ops: [{ ...reparent, from: reparent.to, to: reparent.from }],
      })).not.toThrow();
    });

    it('is accepted with a null parent — a VOB promoted to a root', () => {
      expect(() => assertApplyOpsRequest({
        ops: [{ ...reparent, to: { path: '9', parentPath: null, slot: 9 } }],
      })).not.toThrow();
    });

    it('rejects a side that is not a slot', () => {
      for (const bad of [null, '2/1', { path: '2/1', slot: 1 }, { parentPath: '2', slot: 1 }]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...reparent, to: bad }] })).toThrow(/to/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...reparent, from: bad }] })).toThrow(/from/);
      }
    });

    it('rejects paths that are not slot indices, on either side', () => {
      // Both reach C++ and address the VOB tree with it — `to.parentPath` is
      // where the subtree lands, and a bad one moves the wrong VOB.
      for (const bad of ['', '/', '0//2', 'a/b', '0/2/', 3, null]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...reparent, to: { ...reparent.to, path: bad } }],
        })).toThrow(/path/);
      }
      for (const bad of ['', '/', '0//2', 'a/b', 3]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...reparent, to: { ...reparent.to, parentPath: bad } }],
        })).toThrow(/parentPath/);
      }
    });

    it('rejects a slot that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null]) {
        expect(() => assertApplyOpsRequest({
          ops: [{ ...reparent, to: { ...reparent.to, slot: bad } }],
        })).toThrow(/slot/);
      }
    });
  });

  describe('a delete', () => {
    // The op with no inverse (§15). It carries a `vob` and a `path` and nothing
    // else, which makes it the one op where an extra field is the interesting
    // case: a `from` on it would be somebody constructing an `AddVob`-shaped
    // delete, and that shape means "this op describes the VOB completely".
    const remove = { op: 'DeleteVob', vob: 5, path: '2/1' };

    it('is accepted with just a vob and a path', () => {
      expect(() => assertApplyOpsRequest({ ops: [remove] })).not.toThrow();
    });

    it('is accepted for a root', () => {
      expect(() => assertApplyOpsRequest({ ops: [{ ...remove, vob: 0, path: '0' }] }))
        .not.toThrow();
    });

    it('rejects a path that is not slot indices', () => {
      for (const bad of ['', '/', '0//2', 'a/b', '2/1/', 3, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...remove, path: bad }] })).toThrow(/path/);
      }
    });

    it('rejects a vob that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...remove, vob: bad }] })).toThrow(/vob/);
      }
    });

    it('rejects anything beyond the address it is allowed to carry', () => {
      // The op is uninvertible on purpose, and a delete that arrived carrying a
      // `from` is either a mislabelled `AddVob` or something reaching for an
      // inverse this op does not have. Either way the honest answer is a
      // refusal at the boundary rather than a field the writer silently ignores.
      for (const extra of ['from', 'to', 'parentPath', 'fromBbox']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...remove, [extra]: null }] }))
          .toThrow(new RegExp(extra));
      }
    });
  });

  describe('a waypoint move', () => {
    // The first op that is not about a VOB at all. A reparent got as far as
    // needing to sit before the `path` check; this one carries neither `path`
    // nor `vob`, so it has to sit before the `vob` check as well — and the
    // failure of getting that wrong is not a refusal the caller can read, it is
    // a message about a field the op has no business having.
    const move = {
      op: 'MoveWaypoint', waypoint: 12, name: 'WP_CITY_01',
      from: [1, 2, 3], to: [4, 5, 6],
    };

    it('is accepted carrying no vob and no path at all', () => {
      expect(() => assertApplyOpsRequest({ ops: [move] })).not.toThrow();
    });

    it('is accepted alongside a VOB op in one batch', () => {
      // Neither structural nor renumbering, so it may share a batch — and the
      // validator must not be the layer that decides otherwise.
      expect(() => assertApplyOpsRequest({
        ops: [move, { op: 'MoveVob', vob: 3, path: '0/1', from: [0, 0, 0], to: [1, 1, 1] }],
      })).not.toThrow();
    });

    it('rejects a waypoint index that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...move, waypoint: bad }] }))
          .toThrow(/waypoint/);
      }
    });

    it('rejects a missing name — the guard is not an optional extra', () => {
      // Without it the op addresses a waypoint by a bare index, and a stale
      // index always resolves to a waypoint rather than to nothing.
      for (const bad of [undefined, null, 12, {}]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...move, name: bad }] })).toThrow(/name/);
      }
    });

    it('rejects a side that is not three finite numbers', () => {
      for (const bad of [[1, 2], [1, 2, 3, 4], [1, 2, NaN], [1, 2, Infinity], '1,2,3', null]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...move, to: bad }] })).toThrow(/to/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...move, from: bad }] })).toThrow(/from/);
      }
    });
  });

  describe('a waypoint rename', () => {
    // The second waynet op, and it carries no `vob` and no `path` either — so
    // it shares the waypoint branch's placement and needs its own shape check:
    // the two sides are *names* here, and a move's three-number check would
    // refuse every one of them.
    const rename = { op: 'RenameWaypoint', waypoint: 12, from: 'WP_CITY_01', to: 'WP_CITY_02' };

    it('is accepted carrying no vob and no path at all', () => {
      expect(() => assertApplyOpsRequest({ ops: [rename] })).not.toThrow();
    });

    it('rejects a waypoint index that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...rename, waypoint: bad }] }))
          .toThrow(/waypoint/);
      }
    });

    it('rejects a side that is not a string — `from` is the guard here', () => {
      for (const bad of [undefined, null, 12, {}, ['WP']]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...rename, from: bad }] })).toThrow(/from/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...rename, to: bad }] })).toThrow(/to/);
      }
    });

    it('rejects an empty new name', () => {
      // A waypoint with no name cannot be addressed by the index+name pair at
      // all — the guard every waynet op stands on would have nothing to check.
      expect(() => assertApplyOpsRequest({ ops: [{ ...rename, to: '' }] })).toThrow(/to/);
    });
  });

  describe('a waypoint add', () => {
    // The third waynet op (§16.7, W2), and the first with a *nullable* side:
    // null means "not in the waynet", so one shape covers both the append and
    // the removal its inverse is. The name is at the top level rather than on a
    // side, because it describes the one waypoint the op is about whichever
    // direction it runs.
    const add = { op: 'AddWaypoint', waypoint: 12, name: 'FP_ADDED', from: null, to: [1, 2, 3] };

    it('is accepted carrying no vob and no path at all', () => {
      expect(() => assertApplyOpsRequest({ ops: [add] })).not.toThrow();
      expect(() => assertApplyOpsRequest({ ops: [{ ...add, from: [1, 2, 3], to: null }] }))
        .not.toThrow();
    });

    it('rejects a waypoint index that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...add, waypoint: bad }] }))
          .toThrow(/waypoint/);
      }
    });

    it('rejects a name that is not a non-empty string', () => {
      for (const bad of [undefined, null, 12, '', {}]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...add, name: bad }] })).toThrow(/name/);
      }
    });

    it('rejects a side that is neither null nor three finite numbers', () => {
      for (const bad of [[1, 2], [1, 2, 3, 4], [1, 2, NaN], '1,2,3', 3]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...add, to: bad }] })).toThrow(/to/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...add, from: bad, to: null }] }))
          .toThrow(/from/);
      }
    });

    it('rejects an op that is in the waynet on both sides, or on neither', () => {
      // Exactly one side is null: an add puts a waypoint where there was none,
      // and its inverse takes it away again. Both sides filled describes no
      // edit, and neither describes nothing at all — and both would reach the
      // binding as an append nobody asked for.
      expect(() => assertApplyOpsRequest({ ops: [{ ...add, from: [4, 5, 6] }] }))
        .toThrow(/exactly one/);
      expect(() => assertApplyOpsRequest({ ops: [{ ...add, to: null }] })).toThrow(/exactly one/);
    });
  });

  describe('a waypoint edge', () => {
    // The fourth waynet op (§16.7, W3), and the first with *two* endpoints: an
    // edge is a pair of waypoints, so each end carries the index+name pair the
    // other three carry once. Its sides are booleans — whether the edge is
    // there — which is what lets one shape be both the join and its undo.
    const edge = {
      op: 'SetWaypointEdge',
      a: 3, aName: 'WP_A', b: 12, bName: 'WP_B', from: false, to: true,
    };

    it('is accepted carrying no vob and no path at all', () => {
      expect(() => assertApplyOpsRequest({ ops: [edge] })).not.toThrow();
      expect(() => assertApplyOpsRequest({ ops: [{ ...edge, from: true, to: false }] }))
        .not.toThrow();
    });

    it('rejects an endpoint index that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...edge, a: bad }] })).toThrow(/a must be/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...edge, b: bad }] })).toThrow(/b must be/);
      }
    });

    it('rejects an endpoint name that is not a string', () => {
      // The guard each bare index needs, on both ends: a stale index always
      // resolves to *a* waypoint, so an edge made without one is an edge
      // between whichever two the indices now name.
      for (const bad of [undefined, null, 12, {}]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...edge, aName: bad }] }))
          .toThrow(/aName/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...edge, bName: bad }] }))
          .toThrow(/bName/);
      }
    });

    it('rejects a waypoint joined to itself', () => {
      expect(() => assertApplyOpsRequest({ ops: [{ ...edge, b: 3, bName: 'WP_A' }] }))
        .toThrow(/itself/);
    });

    it('rejects sides that are not one boolean each, or that agree', () => {
      // Both sides the same describes no edit — and would reach the binding as
      // a join or an unjoin nobody asked for.
      for (const bad of [undefined, null, 0, 'true']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...edge, to: bad }] })).toThrow(/to/);
        expect(() => assertApplyOpsRequest({ ops: [{ ...edge, from: bad }] })).toThrow(/from/);
      }
      expect(() => assertApplyOpsRequest({ ops: [{ ...edge, from: true }] }))
        .toThrow(/exactly one/);
      expect(() => assertApplyOpsRequest({ ops: [{ ...edge, to: false }] }))
        .toThrow(/exactly one/);
    });
  });

  describe('a waypoint delete', () => {
    // The fifth waynet op (§16.7, W4), and the waynet's `DeleteVob`: an index,
    // the name that guards it, and nothing else. The exhaustive key check is
    // here for the reason it is on a VOB delete — this op is a barrier, so a
    // side arriving on it is somebody reaching for an inverse it has not got,
    // and an ignored field would let that through as an ordinary delete.
    const remove = { op: 'DeleteWaypoint', waypoint: 12, name: 'WP_CITY_01' };

    it('is accepted carrying no vob and no path at all', () => {
      expect(() => assertApplyOpsRequest({ ops: [remove] })).not.toThrow();
      expect(() => assertApplyOpsRequest({ ops: [{ ...remove, waypoint: 0 }] })).not.toThrow();
    });

    it('rejects a waypoint that is not a non-negative integer', () => {
      for (const bad of [-1, 1.5, '0', NaN, null, undefined]) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...remove, waypoint: bad }] }))
          .toThrow(/waypoint/);
      }
    });

    it('rejects a missing or empty name', () => {
      // The guard the bare index needs, and the one thing the barrier does not
      // buy off: a stale index resolves to *a* waypoint and this op deletes it.
      for (const bad of [undefined, null, 12, {}, '']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...remove, name: bad }] })).toThrow(/name/);
      }
    });

    it('rejects anything beyond the address it is allowed to carry', () => {
      for (const extra of ['from', 'to', 'vob', 'path']) {
        expect(() => assertApplyOpsRequest({ ops: [{ ...remove, [extra]: null }] }))
          .toThrow(new RegExp(extra));
      }
    });
  });
});
