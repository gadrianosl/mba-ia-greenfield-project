import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VIDEO_QUEUE } from './queue/video-queue.module';
import { VideosService } from './videos.service';

const PART_SIZE = 64 * 1024 * 1024;
const MAX_SIZE = 10 * 1024 * 1024 * 1024;
const USER_ID = 'owner-id';
const PUBLIC_ID = 'video-public-id';
const KEY = 'videos/video-public-id/original';

function uploadingVideo(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: 'video-id',
    public_id: PUBLIC_ID,
    channel_id: 'channel-id',
    status: VideoStatus.UPLOADING,
    storage_key: KEY,
    upload_id: 'upload-id',
    upload_part_size: PART_SIZE,
    upload_expires_at: new Date(Date.now() + 60_000),
    file_size: String(PART_SIZE + 10),
    mime_type: 'video/mp4',
    ...overrides,
  });
}

describe('VideosService', () => {
  let service: VideosService;
  let module: TestingModule;
  let video: Video;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let channels: { findOneBy: jest.Mock };
  let storage: {
    buildVideoKey: jest.Mock;
    initiateMultipart: jest.Mock;
    abortMultipart: jest.Mock;
    listParts: jest.Mock;
    completeMultipart: jest.Mock;
    headObject: jest.Mock;
  };
  let queue: { add: jest.Mock };
  const parts = [
    { part_number: 1, etag: 'etag-1' },
    { part_number: 2, etag: 'etag-2' },
  ];

  beforeEach(async () => {
    video = uploadingVideo();
    repo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(video)),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
      manager: {
        transaction: jest
          .fn()
          .mockImplementation((callback) =>
            callback({ getRepository: () => repo }),
          ),
      },
    };
    channels = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'channel-id' }),
    };
    storage = {
      buildVideoKey: jest.fn().mockReturnValue(KEY),
      initiateMultipart: jest.fn().mockResolvedValue('new-upload-id'),
      abortMultipart: jest.fn().mockResolvedValue(undefined),
      listParts: jest.fn().mockResolvedValue([
        { ...parts[0], size: PART_SIZE },
        { ...parts[1], size: 10 },
      ]),
      completeMultipart: jest.fn().mockResolvedValue(undefined),
      headObject: jest
        .fn()
        .mockResolvedValue({ ContentLength: PART_SIZE + 10 }),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: repo },
        { provide: getRepositoryToken(Channel), useValue: channels },
        { provide: StorageService, useValue: storage },
        { provide: getQueueToken(VIDEO_QUEUE), useValue: queue },
        {
          provide: storageConfig.KEY,
          useValue: {
            uploadPartSize: PART_SIZE,
            maxVideoSizeBytes: MAX_SIZE,
            presignedExpiresInSeconds: 3600,
          },
        },
      ],
    }).compile();
    service = module.get(VideosService);
  });

  afterEach(async () => module.close());

  it('should initiate a multipart session at the 10 GiB limit', async () => {
    video = uploadingVideo({ status: VideoStatus.DRAFT });
    await service.initializeUpload(USER_ID, PUBLIC_ID, {
      file_size: MAX_SIZE,
      mime_type: 'video/mp4',
    });
    expect(storage.initiateMultipart).toHaveBeenCalledWith(KEY, 'video/mp4');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.UPLOADING,
        file_size: String(MAX_SIZE),
        upload_id: 'new-upload-id',
        upload_part_size: PART_SIZE,
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([MAX_SIZE + 1, 0, -1, 1.5])(
    'should reject invalid size %i before creating storage or draft state',
    async (file_size) => {
      await expect(
        service.startUpload(USER_ID, {
          title: 'Video',
          file_size,
          mime_type: 'video/mp4',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_UPLOAD' });
      expect(repo.save).not.toHaveBeenCalled();
      expect(storage.initiateMultipart).not.toHaveBeenCalled();
    },
  );

  it('should hide a video belonging to another channel without storage effects', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.completeUpload(USER_ID, PUBLIC_ID, { parts }),
    ).rejects.toMatchObject({ httpStatus: 404, errorCode: 'VIDEO_NOT_FOUND' });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { public_id: PUBLIC_ID, channel_id: 'channel-id' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should abort storage and reset the draft when cancelling a session', async () => {
    await service.cancelUpload(USER_ID, PUBLIC_ID);
    expect(storage.abortMultipart).toHaveBeenCalledWith(KEY, 'upload-id');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.DRAFT,
        upload_id: null,
        storage_key: null,
        file_size: null,
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should abort the newly initiated session if persistence fails', async () => {
    video.status = VideoStatus.DRAFT;
    repo.save.mockRejectedValue(new Error('database unavailable'));
    await expect(
      service.initializeUpload(USER_ID, PUBLIC_ID, {
        file_size: 10,
        mime_type: 'video/mp4',
      }),
    ).rejects.toThrow('database unavailable');
    expect(storage.abortMultipart).toHaveBeenCalledWith(KEY, 'new-upload-id');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should reuse an active session without initiating a second upload', async () => {
    await service.initializeUpload(USER_ID, PUBLIC_ID, {
      file_size: PART_SIZE + 10,
      mime_type: 'video/mp4',
    });
    expect(storage.initiateMultipart).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it.each(['etag', 'size', 'missing'])(
    'should reject %s mismatch before completing storage or publishing work',
    async (mismatch) => {
      storage.listParts.mockResolvedValue(
        mismatch === 'missing'
          ? [{ ...parts[0], size: PART_SIZE }]
          : [
              {
                ...parts[0],
                size: PART_SIZE,
                ...(mismatch === 'etag'
                  ? { etag: 'other' }
                  : { size: PART_SIZE - 1 }),
              },
              { ...parts[1], size: 10 },
            ],
      );
      await expect(
        service.completeUpload(USER_ID, PUBLIC_ID, { parts }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_UPLOAD' });
      expect(storage.completeMultipart).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it.each([[parts[0]], [parts[0], parts[0]]])(
    'should reject incomplete or duplicate submitted parts',
    async (...submitted) => {
      await expect(
        service.completeUpload(USER_ID, PUBLIC_ID, { parts: submitted }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_UPLOAD' });
      expect(storage.listParts).not.toHaveBeenCalled();
      expect(storage.completeMultipart).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('should not publish work when the completed object has a different total size', async () => {
    storage.headObject.mockResolvedValue({ ContentLength: PART_SIZE });
    await expect(
      service.completeUpload(USER_ID, PUBLIC_ID, { parts }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_VIDEO_UPLOAD' });
    expect(repo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should publish a stable retryable job only after saving the completed upload', async () => {
    await service.completeUpload(USER_ID, PUBLIC_ID, {
      parts: [...parts].reverse(),
    });
    expect(storage.completeMultipart).toHaveBeenCalledWith(
      KEY,
      'upload-id',
      parts,
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.UPLOADED,
        upload_id: null,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      { videoId: video.id, storageKey: KEY },
      {
        jobId: video.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
      },
    );
    expect(repo.save.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
  });

  it('should retry queue publication idempotently for an already uploaded video', async () => {
    video.status = VideoStatus.UPLOADED;
    video.upload_id = null;
    await service.completeUpload(USER_ID, PUBLIC_ID, { parts });
    await service.completeUpload(USER_ID, PUBLIC_ID, { parts });
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls.map((call) => call[2].jobId)).toEqual([
      video.id,
      video.id,
    ]);
  });
});
