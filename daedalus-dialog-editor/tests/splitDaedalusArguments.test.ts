import { splitDaedalusArguments } from '../src/renderer/components/actionRenderers/splitDaedalusArguments';

const fixtures = [
  { text: 'self, "one,two", SPL_FIRE', args: ['self', '"one,two"', 'SPL_FIRE'] },
  { text: 'Probe(1, Other(2, 3)), values[Compute(1, 2)]', args: ['Probe(1, Other(2, 3))', 'values[Compute(1, 2)]'] },
  { text: 'self /* , ) " */, other', args: ['self /* , ) " */', 'other'] },
  { text: 'self // , ) "\n, other', args: ['self // , ) "\n', 'other'] },
  { text: 'self // note\r\n, other', args: ['self // note\r\n', 'other'] },
  { text: '"first,\nsecond", other', args: ['"first,\nsecond"', 'other'] },
  { text: '"path\\", other', args: ['"path\\"', 'other'] },
  { text: 'self, Probe(1,', args: ['self', 'Probe(1,'] },
  { text: '  ', args: [] },
  { text: ' self , other ', args: ['self', 'other'] }
];

for (const { text, args } of fixtures) {
  test(`split teaching arguments without changing expression text: ${JSON.stringify(text)}`, () => {
    expect(splitDaedalusArguments(text)).toEqual(args);
  });
}
