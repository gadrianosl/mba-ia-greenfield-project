import { normalizeRange } from './streaming-range';
import { VideoException } from './video.exception';

describe('normalizeRange', () => {
  it.each([
    ['bytes=10-20', 100, 'bytes=10-20'],
    ['bytes=10-', 100, 'bytes=10-99'],
    ['bytes=-20', 100, 'bytes=80-99'],
    ['bytes=-200', 100, 'bytes=0-99'],
    ['bytes=10-200', 100, 'bytes=10-99'],
    ['bytes=0-0', 1, 'bytes=0-0'],
  ])('should normalize %s for a %i-byte object', (range, size, expected) => {
    expect(normalizeRange(range, size)).toBe(expected);
  });

  it.each([
    ['bytes=0-10,20-30', 100],
    ['bytes=100-', 100],
    ['bytes=20-10', 100],
    ['bytes=-0', 100],
    ['bytes=-', 100],
    ['items=0-10', 100],
    ['bytes=0-1', 0],
    ['bytes=9007199254740992-', 100],
  ])('should reject unsatisfiable range %s for %i bytes', (range, size) => {
    expect(() => normalizeRange(range, size)).toThrow(VideoException);
    try {
      normalizeRange(range, size);
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: 'RANGE_NOT_SATISFIABLE',
        httpStatus: 416,
      });
    }
  });
});
