import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// Enable MapSet support for Immer
enableMapSet();

export enum FileUploadStatus {
  NOT_STARTED = 0,
  UPLOADING = 1,
  UPLOADED = 2,
  CANCELLED = 3,
  FAILED = 4,
}

export interface UploadFile {
  id: string;
  file: File;
  status: FileUploadStatus;
  totalChunks: number;
  controller: AbortController;
  progress: number;
}

export interface UploadState {
  filesIds: string[];
  fileMap: Record<string, UploadFile>;
  currentFileId: string; // Keep for backward compatibility
  activeUploads: Set<string>; // Track currently uploading files
  collapse: boolean;
  fileDialogOpen: boolean;
  uploadOpen: boolean;
  actions: {
    addFiles: (files: File[]) => void;
    setCurrentFileId: (id: string) => void;
    toggleCollapse: () => void;
    setFileUploadStatus: (id: string, status: FileUploadStatus) => void;
    removeFile: (id: string) => void;
    cancelUpload: () => void;
    setFileDialogOpen: (open: boolean) => void;
    setUploadOpen: (open: boolean) => void;
    setProgress: (id: string, progress: number) => void;
    addActiveUpload: (id: string) => void;
    removeActiveUpload: (id: string) => void;
  };
}

export const useFileUploadStore = create<UploadState>()(
  immer((set) => ({
    filesIds: [],
    fileMap: {},
    currentFileId: "",
    activeUploads: new Set<string>(),
    collapse: false,
    fileDialogOpen: false,
    uploadOpen: false,
    actions: {
      addFiles: (files: File[]) =>
        set((state) => {
          const newFiles = files.map((file) => ({
            id: Math.random().toString(36).slice(2, 9),
            file,
            status: FileUploadStatus.NOT_STARTED,
            totalChunks: 0,
            controller: new AbortController(),
            progress: 0,
          }));

          // First add all files to the map
          newFiles.forEach((file) => {
            state.fileMap[file.id] = file;
          });

          // Then add IDs to the array
          const ids = newFiles.map((file) => file.id);
          state.filesIds.push(...ids);
          
          // Set current file ID if none is set
          if (!state.currentFileId && ids.length > 0) {
            state.currentFileId = ids[0];
          }
        }),

      setProgress: (id: string, progress: number) =>
        set((state) => {
          if (state.fileMap[id]) {
            if (Math.abs(state.fileMap[id].progress - progress) >= 1 || progress === 100) {
              state.fileMap[id].progress = progress;
            }
          }
        }),
      setFileUploadStatus: (id: string, status: FileUploadStatus) =>
        set((state) => {
          if (state.fileMap[id]) {
            state.fileMap[id].status = status;
          }
        }),

      setCurrentFileId: (id: string) =>
        set((state) => {
          state.currentFileId = id;
        }),

      removeFile: (id: string) =>
        set((state) => {
          const file = state.fileMap[id];
          if (file?.controller) {
            file.controller.abort();
          }
          delete state.fileMap[id];
          state.filesIds = state.filesIds.filter((fileId) => fileId !== id);
          state.activeUploads.delete(id);
          
          if (state.filesIds.length === 0) {
            state.currentFileId = "";
            state.collapse = false;
            state.uploadOpen = false;
            state.fileMap = {};
            state.activeUploads.clear();
          }
        }),

      cancelUpload: () =>
        set((state) => {
          // Cancel all active uploads
          Object.values(state.fileMap).forEach(file => {
            if (file?.controller) {
              file.controller.abort();
            }
          });
          // Clear all state
          state.fileMap = {};
          state.filesIds = [];
          state.currentFileId = "";
          state.activeUploads.clear();
          state.collapse = false;
          state.uploadOpen = false;
        }),
      toggleCollapse: () =>
        set((state) => {
          state.collapse = !state.collapse;
        }),
      setFileDialogOpen: (open: boolean) =>
        set((state) => {
          state.fileDialogOpen = open;
        }),
      setUploadOpen: (open: boolean) =>
        set((state) => {
          state.uploadOpen = open;
        }),

      addActiveUpload: (id: string) =>
        set((state) => {
          state.activeUploads.add(id);
        }),

      removeActiveUpload: (id: string) =>
        set((state) => {
          state.activeUploads.delete(id);
        }),
    },
  })),
);
