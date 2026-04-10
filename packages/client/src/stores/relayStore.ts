import { create } from 'zustand';

/**
 * Relay 연결 상태 인터페이스
 */
export interface RelayState {
  /** WebSocket 연결 여부 */
  isConnected: boolean;

  /** 인증 완료 여부 */
  isAuthenticated: boolean;

  /** Relay에서 발급받은 디바이스 ID */
  deviceId: string | null;

  /** Direct Connection으로 연결된 Pylon deviceId 목록 */
  directDeviceIds: number[];

  // Actions
  setConnected: (connected: boolean) => void;
  setAuthenticated: (authenticated: boolean) => void;
  setDeviceId: (deviceId: string | null) => void;
  addDirectDevice: (deviceId: number) => void;
  removeDirectDevice: (deviceId: number) => void;
  clearDirectDevices: () => void;
  reset: () => void;
}

/**
 * 초기 상태
 */
const initialState = {
  isConnected: false,
  isAuthenticated: false,
  deviceId: null,
  directDeviceIds: [] as number[],
};

/**
 * Relay 연결 상태 관리 스토어
 *
 * WebSocket 연결, 인증 상태를 관리합니다.
 */
export const useRelayStore = create<RelayState>((set) => ({
  ...initialState,

  setConnected: (connected) => {
    if (connected) {
      set({ isConnected: true });
    } else {
      // 연결 해제 시 모든 상태 초기화
      set({
        isConnected: false,
        isAuthenticated: false,
        deviceId: null,
      });
    }
  },

  setAuthenticated: (authenticated) => {
    set({ isAuthenticated: authenticated });
  },

  setDeviceId: (deviceId) => {
    set({ deviceId });
  },

  addDirectDevice: (deviceId) => {
    set((state) => ({
      directDeviceIds: state.directDeviceIds.includes(deviceId)
        ? state.directDeviceIds
        : [...state.directDeviceIds, deviceId],
    }));
  },

  removeDirectDevice: (deviceId) => {
    set((state) => ({
      directDeviceIds: state.directDeviceIds.filter((id) => id !== deviceId),
    }));
  },

  clearDirectDevices: () => {
    set({ directDeviceIds: [] });
  },

  reset: () => {
    set({ ...initialState, directDeviceIds: [] });
  },
}));
