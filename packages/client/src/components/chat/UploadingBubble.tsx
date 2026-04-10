import { useImageUploadStore } from '../../stores';
import { imageCache } from '../../services/imageCacheService';
import { cn } from '../../lib/utils';

interface UploadingBubbleProps {
  blobId: string;
  /** 같이 전송한 메시지 */
  message?: string;
}

/**
 * 업로드 중 버블 (v1 Flutter UploadingImageBubble 대응)
 * - 이미지 미리보기
 * - 진행률 바
 * - 상태별 색상 (업로드/완료/실패)
 * - 같이 전송한 메시지 표시
 */
export function UploadingBubble({ blobId, message }: UploadingBubbleProps) {
  const { blobUploads, getBlobProgress, attachedImages } = useImageUploadStore();
  const upload = blobUploads[blobId];
  const progress = getBlobProgress(blobId);
  const attachedImage = attachedImages.find((img) => img.id === blobId);

  if (!upload) return null;

  const isCompleted = upload.status === 'completed';
  const isFailed = upload.status === 'failed';
  const isUploading = upload.status === 'uploading';

  // 테두리 색상
  const borderColorClass = isFailed
    ? 'border-destructive'
    : isCompleted
    ? 'border-green-500'
    : 'border-primary';

  return (
    <div className="my-1 max-w-[90%]">
      <div
        className={cn(
          'px-3 py-2 rounded border-l-2 bg-card shadow-sm',
          borderColorClass
        )}
      >
        <div className="flex items-start">
          {/* 이미지 미리보기 */}
          <ImagePreview uri={attachedImage?.uri} filename={upload.filename} />

          {/* 정보 영역 */}
          <div className="flex-1 ml-3 min-w-0">
            {/* 파일명 */}
            <p className="text-sm truncate">
              {upload.filename}
            </p>

            {/* 상태 텍스트 */}
            <div className="mt-1">
              {isFailed && (
                <p className="text-xs text-destructive">
                  업로드 실패
                </p>
              )}
              {isCompleted && (
                <p className="text-xs text-green-500">
                  업로드 완료
                </p>
              )}
              {isUploading && (
                <p className="text-xs text-muted-foreground">
                  업로드 중... {progress}%
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 진행률 바 (업로드 중일 때만) */}
        {isUploading && (
          <div className="mt-2">
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 같이 보낸 메시지 */}
        {message && message.trim().length > 0 && (
          <p className="text-sm mt-2 leading-5">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 이미지 미리보기
 */
function ImagePreview({ uri, filename }: { uri?: string; filename: string }) {
  // 캐시에서 이미지 확인
  const cachedData = imageCache.get(filename);

  if (uri) {
    return (
      <img
        src={uri}
        alt={filename}
        className="w-16 h-16 rounded object-cover"
      />
    );
  }

  if (cachedData) {
    // Uint8Array를 base64로 변환
    const base64 = btoa(
      Array.from(cachedData)
        .map((byte) => String.fromCharCode(byte))
        .join('')
    );
    const mimeType = getMimeType(filename);
    return (
      <img
        src={`data:${mimeType};base64,${base64}`}
        alt={filename}
        className="w-16 h-16 rounded object-cover"
      />
    );
  }

  // 플레이스홀더
  return (
    <div
      className="w-16 h-16 rounded bg-muted flex items-center justify-center border border-border"
    >
      <span className="text-xl">📷</span>
    </div>
  );
}

/**
 * 파일명에서 MIME 타입 추출
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}
