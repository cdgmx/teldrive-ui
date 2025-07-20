import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { FileExistsResult } from "./upload-helpers";

export interface DuplicateFileItem {
  file: File;
  existingFile: FileExistsResult;
  action: 'skip' | 'overwrite' | 'rename';
  newName?: string;
}

interface DuplicateFilesState {
  duplicates: DuplicateFileItem[];
  isOpen: boolean;
  actions: {
    setDuplicates: (duplicates: Array<{ file: File; existingFile: FileExistsResult }>) => void;
    updateAction: (index: number, action: 'skip' | 'overwrite' | 'rename', newName?: string) => void;
    close: () => void;
    applyAll: (action: 'skip' | 'overwrite') => void;
  };
}

export const useDuplicateFilesStore = create<DuplicateFilesState>()(
  immer((set) => ({
    duplicates: [],
    isOpen: false,
    actions: {
      setDuplicates: (duplicates) =>
        set((state) => {
          state.duplicates = duplicates.map(item => ({
            file: item.file,
            existingFile: item.existingFile,
            action: 'skip', // Default action
          }));
          state.isOpen = duplicates.length > 0;
        }),

      updateAction: (index, action, newName) =>
        set((state) => {
          if (state.duplicates[index]) {
            state.duplicates[index].action = action;
            if (newName) {
              state.duplicates[index].newName = newName;
            }
          }
        }),

      close: () =>
        set((state) => {
          state.isOpen = false;
          state.duplicates = [];
        }),

      applyAll: (action) =>
        set((state) => {
          state.duplicates.forEach(item => {
            item.action = action;
          });
        }),
    },
  }))
);

/**
 * Generate a unique filename by appending a counter
 */
export function generateUniqueFilename(originalName: string, existingNames: Set<string>): string {
  if (!existingNames.has(originalName)) {
    return originalName;
  }

  const lastDotIndex = originalName.lastIndexOf('.');
  const name = lastDotIndex > -1 ? originalName.substring(0, lastDotIndex) : originalName;
  const extension = lastDotIndex > -1 ? originalName.substring(lastDotIndex) : '';

  let counter = 1;
  let newName: string;
  
  do {
    newName = `${name} (${counter})${extension}`;
    counter++;
  } while (existingNames.has(newName) && counter < 1000); // Safety limit

  return newName;
}

/**
 * Smart duplicate resolution with size comparison
 */
export function shouldSkipDuplicate(file: File, existingFile: FileExistsResult): boolean {
  // If sizes match exactly, likely same file
  if (existingFile.size === file.size) {
    return true;
  }
  
  // If existing file is significantly larger, might be different
  if (existingFile.size && existingFile.size > file.size * 1.1) {
    return false;
  }
  
  // Default to skip for safety
  return true;
}
