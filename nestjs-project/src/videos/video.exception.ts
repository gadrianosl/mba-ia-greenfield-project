import { DomainException } from '../common/exceptions/domain.exception';

export class VideoException extends DomainException {
  constructor(code: string, status: number, message: string) {
    super(code, status, message);
  }
}

export const videoNotFound = () =>
  new VideoException('VIDEO_NOT_FOUND', 404, 'Video not found');
export const videoConflict = () =>
  new VideoException(
    'VIDEO_STATE_CONFLICT',
    409,
    'Operation is not allowed in the current video state',
  );
export const invalidUpload = (message: string) =>
  new VideoException('INVALID_VIDEO_UPLOAD', 400, message);
