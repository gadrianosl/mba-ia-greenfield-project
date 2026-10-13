import { VideoException } from './video.exception';

export function normalizeRange(range: string, size: number): string {
  const invalid = () =>
    new VideoException(
      'RANGE_NOT_SATISFIABLE',
      416,
      'Requested range is outside the video',
    );
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw invalid();
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalid();
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start
    )
      throw invalid();
    end = Math.min(end, size - 1);
  }
  return `bytes=${start}-${end}`;
}
