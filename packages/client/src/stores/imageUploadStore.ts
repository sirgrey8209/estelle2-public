import { create } from 'zustand';

/**
 * 업로드 정보 인터페이스 (이미지 처리 추적용)
 */
export interface UploadInfo {
  blobId: string;
  filename: string;
  totalChunks: number;
  processedChunks: number;
  status: 'uploading' | 'completed' | 'failed';
  error?: string;
  fileId?: string;
}

/**
 * Blob 전송 업로드 정보 (구 uploadStore의 UploadInfo)
 */
export type BlobUploadStatus = 'uploading' | 'completed' | 'failed';

export interface BlobUploadInfo {
  blobId: string;
  filename: string;
  status: BlobUploadStatus;
  sentChunks: number;
  totalChunks: number;
  serverPath?: string;
  error?: string;
}

/**
 * 첨부 이미지 정보
 */
export interface AttachedImage {
  /** 고유 ID (blobId와 연결) */
  id: string;
  /** 로컬 URI */
  uri: string;
  /** 파일명 */
  fileName: string;
  /** 원본 File 객체 (업로드 시 필요) */
  file?: File;
  /** MIME 타입 (예: image/png) */
  mimeType?: string;
}

/**
 * 이미지 업로드 상태 인터페이스
 */
export interface ImageUploadState {
  /** 현재 업로드 중인 이미지들 */
  uploads: Map<string, UploadInfo>;

  /** 첨부된 이미지 (전송 전) - 단일 이미지 (하위 호환) */
  attachedImage: AttachedImage | null;

  /** 첨부된 이미지들 (여러 개 지원) */
  attachedImages: AttachedImage[];

  /** 업로드 완료 후 메시지에 첨부할 fileIds */
  recentFileIds: string[];

  /** 업로드 중 대기하는 메시지 */
  queuedMessage: string | null;

  // Computed
  /** 활성 업로드 있는지 */
  hasActiveUpload: boolean;

  // === Blob 전송 추적 (구 uploadStore에서 통합) ===
  /** Blob 업로드 목록 (blobId -> BlobUploadInfo) */
  blobUploads: Record<string, BlobUploadInfo>;

  /** Blob 업로드 중인 항목 존재 여부 */
  isBlobUploading: boolean;

  /** 최근 완료된 Blob 업로드 ID 목록 */
  recentBlobUploads: string[];

  // Actions
  /** 이미지 첨부 (단일) */
  setAttachedImage: (image: AttachedImage | null) => void;

  /** 이미지 추가 (여러 개 지원) */
  addAttachedImage: (image: AttachedImage) => void;

  /** 이미지 제거 */
  removeAttachedImage: (id: string) => void;

  /** 모든 첨부 이미지 클리어 */
  clearAttachedImages: () => void;

  /** 업로드 시작 */
  startUpload: (info: Omit<UploadInfo, 'status' | 'processedChunks'>) => void;

  /** 프로그레스 업데이트 */
  updateProgress: (blobId: string, processedChunks: number) => void;

  /** 완료 */
  completeUpload: (blobId: string, fileId: string) => void;

  /** 실패 */
  failUpload: (blobId: string, error: string) => void;

  /** 제거 */
  removeUpload: (blobId: string) => void;

  /** 메시지 큐 */
  queueMessage: (text: string) => void;
  dequeueMessage: () => string | null;

  /** fileIds 소비 */
  consumeRecentFileIds: () => string[];

  // === Blob 전송 Actions (구 uploadStore에서 통합) ===
  /** Blob 업로드 시작 */
  startBlobUpload: (params: { blobId: string; filename: string; totalChunks: number }) => void;

  /** Blob 진행률 업데이트 */
  updateBlobProgress: (blobId: string, sentChunks: number) => void;

  /** Blob 업로드 완료 */
  completeBlobUpload: (blobId: string, serverPath: string) => void;

  /** Blob 업로드 실패 */
  failBlobUpload: (blobId: string, error: string) => void;

  /** Blob 진행률 퍼센트 조회 */
  getBlobProgress: (blobId: string) => number;

  /** 최근 완료된 Blob 업로드 ID 소비 */
  consumeRecentBlobUploads: () => string[];

  /** 초기화 */
  reset: () => void;
}

/**
 * Blob 업로드 중인 항목이 있는지 확인
 */
function hasActiveBlobUploads(uploads: Record<string, BlobUploadInfo>): boolean {
  return Object.values(uploads).some((u) => u.status === 'uploading');
}

/**
 * 초기 상태
 */
const initialState = {
  uploads: new Map<string, UploadInfo>(),
  attachedImage: null as AttachedImage | null,
  attachedImages: [] as AttachedImage[],
  recentFileIds: [] as string[],
  queuedMessage: null as string | null,
  hasActiveUpload: false,
  // Blob 전송 추적 초기 상태
  blobUploads: {} as Record<string, BlobUploadInfo>,
  isBlobUploading: false,
  recentBlobUploads: [] as string[],
};

/**
 * 이미지 업로드 상태 관리 스토어
 */
export const useImageUploadStore = create<ImageUploadState>((set, get) => ({
  ...initialState,

  setAttachedImage: (image) => {
    set({ attachedImage: image });
    // 단일 이미지를 배열에도 추가/제거
    if (image) {
      set((state) => ({
        attachedImages: [...state.attachedImages.filter((i) => i.id !== image.id), image],
      }));
    }
  },

  /** 이미지 추가 (여러 개 지원) */
  addAttachedImage: (image: AttachedImage) => {
    set((state) => ({
      attachedImages: [...state.attachedImages, image],
      attachedImage: image, // 하위 호환
    }));
  },

  /** 이미지 제거 */
  removeAttachedImage: (id: string) => {
    set((state) => {
      const newImages = state.attachedImages.filter((i) => i.id !== id);
      return {
        attachedImages: newImages,
        attachedImage: newImages.length > 0 ? newImages[newImages.length - 1] : null,
      };
    });
  },

  /** 모든 첨부 이미지 클리어 */
  clearAttachedImages: () => {
    set({ attachedImages: [], attachedImage: null });
  },

  startUpload: (info) => {
    const uploads = new Map(get().uploads);
    uploads.set(info.blobId, {
      ...info,
      status: 'uploading',
      processedChunks: 0,
    });
    set({ uploads, hasActiveUpload: true });
  },

  updateProgress: (blobId, processedChunks) => {
    const uploads = new Map(get().uploads);
    const upload = uploads.get(blobId);
    if (upload) {
      uploads.set(blobId, { ...upload, processedChunks });
      set({ uploads });
    }
  },

  completeUpload: (blobId, fileId) => {
    const uploads = new Map(get().uploads);
    const upload = uploads.get(blobId);
    if (upload) {
      uploads.set(blobId, { ...upload, status: 'completed', fileId });
    }

    // hasActiveUpload 재계산
    const hasActive = Array.from(uploads.values()).some(
      (u) => u.status === 'uploading'
    );

    // recentFileIds에 추가
    const recentFileIds = [...get().recentFileIds, fileId];

    set({ uploads, hasActiveUpload: hasActive, recentFileIds });
  },

  failUpload: (blobId, error) => {
    const uploads = new Map(get().uploads);
    const upload = uploads.get(blobId);
    if (upload) {
      uploads.set(blobId, { ...upload, status: 'failed', error });
    }

    const hasActive = Array.from(uploads.values()).some(
      (u) => u.status === 'uploading'
    );

    set({ uploads, hasActiveUpload: hasActive });
  },

  removeUpload: (blobId) => {
    const uploads = new Map(get().uploads);
    uploads.delete(blobId);

    const hasActive = Array.from(uploads.values()).some(
      (u) => u.status === 'uploading'
    );

    set({ uploads, hasActiveUpload: hasActive });
  },

  queueMessage: (text) => {
    set({ queuedMessage: text });
  },

  dequeueMessage: () => {
    const message = get().queuedMessage;
    set({ queuedMessage: null });
    return message;
  },

  consumeRecentFileIds: () => {
    const fileIds = [...get().recentFileIds];
    set({ recentFileIds: [] });
    return fileIds;
  },

  // === Blob 전송 Methods (구 uploadStore에서 통합) ===

  startBlobUpload: (params) => {
    const { blobId, filename, totalChunks } = params;

    set((state) => ({
      blobUploads: {
        ...state.blobUploads,
        [blobId]: {
          blobId,
          filename,
          status: 'uploading',
          sentChunks: 0,
          totalChunks,
        },
      },
      isBlobUploading: true,
    }));
  },

  updateBlobProgress: (blobId, sentChunks) => {
    set((state) => {
      const upload = state.blobUploads[blobId];
      if (!upload) return state;

      return {
        blobUploads: {
          ...state.blobUploads,
          [blobId]: { ...upload, sentChunks },
        },
      };
    });
  },

  completeBlobUpload: (blobId, serverPath) => {
    set((state) => {
      const upload = state.blobUploads[blobId];
      if (!upload) return state;

      const newBlobUploads = {
        ...state.blobUploads,
        [blobId]: {
          ...upload,
          status: 'completed' as BlobUploadStatus,
          serverPath,
        },
      };

      return {
        blobUploads: newBlobUploads,
        isBlobUploading: hasActiveBlobUploads(newBlobUploads),
        recentBlobUploads: [...state.recentBlobUploads, blobId],
      };
    });
  },

  failBlobUpload: (blobId, error) => {
    set((state) => {
      const upload = state.blobUploads[blobId];
      if (!upload) return state;

      const newBlobUploads = {
        ...state.blobUploads,
        [blobId]: {
          ...upload,
          status: 'failed' as BlobUploadStatus,
          error,
        },
      };

      return {
        blobUploads: newBlobUploads,
        isBlobUploading: hasActiveBlobUploads(newBlobUploads),
      };
    });
  },

  getBlobProgress: (blobId) => {
    const upload = get().blobUploads[blobId];
    if (!upload || upload.totalChunks === 0) return 0;
    return Math.round((upload.sentChunks / upload.totalChunks) * 100);
  },

  consumeRecentBlobUploads: () => {
    const recent = get().recentBlobUploads;
    set({ recentBlobUploads: [] });
    return recent;
  },

  reset: () => {
    set({
      ...initialState,
      uploads: new Map(),
    });
  },
}));
