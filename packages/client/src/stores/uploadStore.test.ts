import { describe, it, expect, beforeEach } from 'vitest';
import { useImageUploadStore } from './imageUploadStore';

/**
 * Blob 업로드 추적 테스트 (구 uploadStore → imageUploadStore로 통합)
 */
describe('imageUploadStore - blob uploads', () => {
  beforeEach(() => {
    useImageUploadStore.getState().reset();
  });

  describe('초기 상태', () => {
    it('should have empty blobUploads', () => {
      const state = useImageUploadStore.getState();

      expect(state.blobUploads).toEqual({});
      expect(state.isBlobUploading).toBe(false);
    });
  });

  describe('업로드 시작', () => {
    it('should start blob upload', () => {
      const { startBlobUpload } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      const upload = useImageUploadStore.getState().blobUploads['blob-1'];
      expect(upload).toBeDefined();
      expect(upload.filename).toBe('image.png');
      expect(upload.status).toBe('uploading');
      expect(upload.sentChunks).toBe(0);
      expect(upload.totalChunks).toBe(10);
    });

    it('should set isBlobUploading to true', () => {
      const { startBlobUpload } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      expect(useImageUploadStore.getState().isBlobUploading).toBe(true);
    });
  });

  describe('업로드 진행률', () => {
    it('should update blob progress', () => {
      const { startBlobUpload, updateBlobProgress } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      updateBlobProgress('blob-1', 5);

      const upload = useImageUploadStore.getState().blobUploads['blob-1'];
      expect(upload.sentChunks).toBe(5);
    });

    it('should calculate blob progress percentage', () => {
      const { startBlobUpload, updateBlobProgress, getBlobProgress } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      updateBlobProgress('blob-1', 5);

      expect(getBlobProgress('blob-1')).toBe(50);
    });
  });

  describe('업로드 완료', () => {
    it('should complete blob upload', () => {
      const { startBlobUpload, completeBlobUpload } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      completeBlobUpload('blob-1', '/path/to/uploaded/image.png');

      const upload = useImageUploadStore.getState().blobUploads['blob-1'];
      expect(upload.status).toBe('completed');
      expect(upload.serverPath).toBe('/path/to/uploaded/image.png');
    });

    it('should add to recent blob uploads', () => {
      const { startBlobUpload, completeBlobUpload } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      completeBlobUpload('blob-1', '/path/image.png');

      expect(useImageUploadStore.getState().recentBlobUploads).toContain('blob-1');
    });

    it('should set isBlobUploading to false when all complete', () => {
      const { startBlobUpload, completeBlobUpload } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      completeBlobUpload('blob-1', '/path/image.png');

      expect(useImageUploadStore.getState().isBlobUploading).toBe(false);
    });
  });

  describe('업로드 실패', () => {
    it('should fail blob upload', () => {
      const { startBlobUpload, failBlobUpload } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      failBlobUpload('blob-1', 'Network error');

      const upload = useImageUploadStore.getState().blobUploads['blob-1'];
      expect(upload.status).toBe('failed');
      expect(upload.error).toBe('Network error');
    });
  });

  describe('최근 업로드 소비', () => {
    it('should consume recent blob uploads', () => {
      const { startBlobUpload, completeBlobUpload, consumeRecentBlobUploads } =
        useImageUploadStore.getState();

      startBlobUpload({ blobId: 'blob-1', filename: 'a.png', totalChunks: 1 });
      startBlobUpload({ blobId: 'blob-2', filename: 'b.png', totalChunks: 1 });

      completeBlobUpload('blob-1', '/a.png');
      completeBlobUpload('blob-2', '/b.png');

      const recent = consumeRecentBlobUploads();

      expect(recent).toHaveLength(2);
      expect(useImageUploadStore.getState().recentBlobUploads).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should reset blob upload state', () => {
      const { startBlobUpload, reset } = useImageUploadStore.getState();

      startBlobUpload({
        blobId: 'blob-1',
        filename: 'image.png',
        totalChunks: 10,
      });

      reset();

      const state = useImageUploadStore.getState();
      expect(state.blobUploads).toEqual({});
      expect(state.isBlobUploading).toBe(false);
      expect(state.recentBlobUploads).toEqual([]);
    });
  });
});
