import { viteFsUrl } from './viteFsUrl';

test('builds the /@fs URL Vite expects on both platforms (#523)', () => {
  // A Windows drive path first: this is the case that failed, `/@fsC:\...`.
  expect(viteFsUrl('C:\\Users\\Daniel\\worldFixtures.ts')).toBe('/@fs/C:/Users/Daniel/worldFixtures.ts');
  expect(viteFsUrl('/home/runner/worldFixtures.ts')).toBe('/@fs/home/runner/worldFixtures.ts');
});
