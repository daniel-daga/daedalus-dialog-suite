// A raw `.3DS` read straight into the chunks a compiled mesh gives (#297), so a
// mod's bush previews, thumbnails and draws before a GMBT build has compiled it.
// The bytes below are built chunk by chunk, the way 3ds Max writes them.

import { extractVisualOrRaw3ds, parse3ds } from '../src/assets';

/** One 3DS chunk: id, total length, payload, sub-chunks. */
function chunk(id: number, payload: number[] | Uint8Array, ...children: Uint8Array[]): Uint8Array {
  const body = [...payload, ...children.flatMap((child) => [...child])];
  const out = new Uint8Array(6 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, id, true);
  view.setUint32(2, out.length, true);
  out.set(body, 6);
  return out;
}
const cstr = (text: string) => [...[...text].map((ch) => ch.charCodeAt(0) & 0xff), 0];
const u16 = (...values: number[]) => values.flatMap((value) => [value & 0xff, value >> 8]);
const f32 = (...values: number[]) => [...new Uint8Array(new Float32Array(values).buffer)];

function material(name: string, texture: string | null, rgb: [number, number, number]) {
  return chunk(0xafff, [],
    chunk(0xa000, cstr(name)),
    chunk(0xa020, [], chunk(0x0011, rgb)),
    ...(texture === null ? [] : [chunk(0xa200, [], chunk(0xa300, cstr(texture)))]));
}

/** A quad of two triangles in 3ds Max's space (Z up), the second triangle on
 *  `second` material when given. */
function object(name: string, { second, uvs = true }: { second?: string; uvs?: boolean } = {}) {
  const faces = chunk(0x4120, [...u16(2), ...u16(0, 1, 2, 0), ...u16(0, 2, 3, 0)],
    chunk(0x4130, [...cstr('WOOD'), ...u16(second === undefined ? 2 : 1), ...u16(0), ...(second === undefined ? u16(1) : [])]),
    ...(second === undefined ? [] : [chunk(0x4130, [...cstr(second), ...u16(1), ...u16(1)])]));
  return chunk(0x4000, cstr(name),
    chunk(0x4100, [],
      chunk(0x4110, [...u16(4), ...f32(0, 0, 0, 100, 0, 0, 100, 0, 50, 0, 0, 50)]),
      faces,
      ...(uvs ? [chunk(0x4140, [...u16(4), ...f32(0, 0, 1, 0, 1, 1, 0, 1)])] : [])));
}

function file(...editChildren: Uint8Array[]): ArrayBuffer {
  const bytes = chunk(0x4d4d, [], chunk(0x0002, [3, 0, 0, 0]), chunk(0x3d3d, [], ...editChildren));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const floats = (buffer: ArrayBuffer) => [...new Float32Array(buffer)];
const ints = (buffer: ArrayBuffer) => [...new Uint32Array(buffer)];

describe('parse3ds', () => {
  it('reads a mesh into ZenGin space: Y and Z swapped, V flipped, the face order kept', () => {
    const visual = parse3ds(file(material('WOOD', 'NW_WOOD.TGA', [200, 100, 50]), object('PLANK')), 'PLANK.3DS')!;

    expect(visual.source).toBe('PLANK.3DS');
    expect(visual.chunks).toHaveLength(1);
    const [only] = visual.chunks;
    // 3ds Max is right-handed and Z-up, ZenGin left-handed and Y-up: the swap
    // is the whole conversion, and being a mirror it also turns Max's
    // counter-clockwise front faces into ZenGin's clockwise ones.
    expect(floats(only.positions)).toEqual([0, 0, 0, 100, 0, 0, 100, 50, 0, 0, 50, 0]);
    expect(ints(only.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    // 3DS puts the texture origin bottom-left, Direct3D top-left.
    expect(floats(only.uvs)).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect(only).toMatchObject({
      name: 'WOOD', texture: 'NW_WOOD.TGA', color: [200, 100, 50, 255], vertexCount: 4, triangleCount: 2,
    });
  });

  it("gives every vertex a unit normal, the face's own for a flat quad", () => {
    const [only] = parse3ds(file(material('WOOD', null, [1, 2, 3]), object('PLANK')), 'PLANK.3DS')!.chunks;
    const normals = floats(only.normals);
    for (let at = 0; at < normals.length; at += 3) {
      const [x, y, z] = normals.slice(at, at + 3);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(Math.abs(z)).toBeCloseTo(1, 5);
      expect([x, y]).toEqual([0, 0]);
    }
  });

  it('points a normal out of the face: a floor facing up in Max faces up in ZenGin', () => {
    // Counter-clockwise seen from above, as Max writes a face that faces +Z.
    // ZenGin's faces run the other way about their normal — the editor's
    // renderer mirrors X and culls back faces, and retail's meshes draw — so
    // the normal is not the right-hand cross of the corners, it is its reverse.
    const floor = chunk(0x4000, cstr('FLOOR'), chunk(0x4100, [],
      chunk(0x4110, [...u16(3), ...f32(0, 0, 0, 100, 0, 0, 100, 100, 0)]),
      chunk(0x4120, [...u16(1), ...u16(0, 1, 2, 0)])));
    const [only] = parse3ds(file(floor), 'FLOOR.3DS')!.chunks;
    const normals = floats(only.normals);
    for (let at = 0; at < normals.length; at += 3) {
      expect(normals[at]).toBeCloseTo(0, 5);
      expect(normals[at + 1]).toBeCloseTo(1, 5);
      expect(normals[at + 2]).toBeCloseTo(0, 5);
    }
  });

  it('splits an object by material, each chunk holding only its own faces and vertices', () => {
    const visual = parse3ds(file(
      material('WOOD', 'NW_WOOD.TGA', [1, 1, 1]), material('IRON', 'NW_IRON.TGA', [2, 2, 2]),
      object('CHEST', { second: 'IRON' }),
    ), 'CHEST.3DS')!;

    expect(visual.chunks.map((part) => [part.name, part.texture, part.triangleCount, part.vertexCount]))
      .toEqual([['WOOD', 'NW_WOOD.TGA', 1, 3], ['IRON', 'NW_IRON.TGA', 1, 3]]);
    expect(ints(visual.chunks[1].indices)).toEqual([0, 1, 2]);
  });

  it('reads every object in the file, and faces with no material as a plain grey one', () => {
    const noMaterial = chunk(0x4000, cstr('LOOSE'), chunk(0x4100, [],
      chunk(0x4110, [...u16(3), ...f32(0, 0, 0, 1, 0, 0, 0, 1, 0)]),
      chunk(0x4120, [...u16(1), ...u16(0, 1, 2, 0)])));
    const visual = parse3ds(file(material('WOOD', null, [9, 9, 9]), object('A'), noMaterial), 'MIXED.3DS')!;

    expect(visual.chunks.map((part) => part.name)).toEqual(['WOOD', '']);
    expect(visual.chunks[1]).toMatchObject({ texture: '', color: [128, 128, 128, 255] });
    // No mapping coordinates: zeros rather than a missing buffer.
    expect(floats(visual.chunks[1].uvs)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('is null for bytes that are not a 3DS file, or are cut short, and never throws', () => {
    expect(parse3ds(new Uint8Array([1, 2, 3, 4]).buffer, 'X.3DS')).toBeNull();
    const whole = new Uint8Array(file(material('WOOD', null, [1, 1, 1]), object('PLANK')));
    expect(parse3ds(whole.slice(0, whole.length - 20).buffer, 'X.3DS')).toBeNull();
    expect(parse3ds(file(), 'EMPTY.3DS')).toBeNull();
  });
});

// The worker's fallback: the binding first, the raw file only when the binding
// finds nothing for a `.3DS` — a compiled half, where there is one, is what
// the game draws and so what the editor draws.
describe('extractVisualOrRaw3ds', () => {
  const plank = file(material('WOOD', null, [1, 1, 1]), object('PLANK'));
  const compiled = { source: 'NW_CRATE.MRM', chunks: [] };

  it('takes what the binding extracts, and reads nothing', () => {
    const read = jest.fn(() => plank);
    expect(extractVisualOrRaw3ds(() => compiled, read, 'NW_CRATE.3DS')).toBe(compiled);
    expect(read).not.toHaveBeenCalled();
  });

  it('reads and parses the raw .3DS when the binding finds no compiled half', () => {
    const read = jest.fn(() => plank);
    const visual = extractVisualOrRaw3ds(() => null, read, 'km_vob_big_bush_01.3ds');
    expect(read).toHaveBeenCalledWith('km_vob_big_bush_01.3ds');
    expect(visual?.source).toBe('KM_VOB_BIG_BUSH_01.3DS');
    expect(visual?.chunks).toHaveLength(1);
  });

  it('is null for a name that is not a .3DS, a .3DS that is not mounted, or one that does not parse', () => {
    expect(extractVisualOrRaw3ds(() => null, () => plank, 'HUMANS.ASC')).toBeNull();
    expect(extractVisualOrRaw3ds(() => null, () => null, 'GONE.3DS')).toBeNull();
    expect(extractVisualOrRaw3ds(() => null, () => new Uint8Array([1, 2, 3]).buffer, 'BAD.3DS')).toBeNull();
  });
});
