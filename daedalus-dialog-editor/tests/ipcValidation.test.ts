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

  it('rejects a non-boolean value for a known key', () => {
    expect(() => assertSaveFileOptions({ skipValidation: 'yes' })).toThrow(/option/i);
  });

  it('rejects a non-object', () => {
    expect(() => assertSaveFileOptions('x')).toThrow(/option/i);
  });
});
