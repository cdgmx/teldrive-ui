import { fetchClient } from "@/utils/api";

export interface FileExistsResult {
  fileName: string;
  exists: boolean;
  fileId?: string;
  size?: number;
  sizeMatches?: boolean;
}

/**
 * Batch check file existence for multiple files in a directory
 * This replaces individual API calls with a single bulk operation
 */
export async function batchCheckFileExists(
  path: string, 
  fileNames: string[]
): Promise<Map<string, FileExistsResult>> {
  try {
    // Get all files in the directory at once
    const res = await fetchClient.GET("/files", {
      params: {
        query: { 
          path, 
          operation: "list",
          // Add pagination if needed for very large directories
          limit: Math.max(fileNames.length * 2, 1000)
        },
      },
    });

    const existingFiles = res.data?.items || [];
    
    // Create a hash map for O(1) lookup
    const existingFilesMap = new Map<string, any>();
    existingFiles.forEach(file => {
      existingFilesMap.set(file.name, file);
    });

    // Build result map
    const resultMap = new Map<string, FileExistsResult>();
    
    fileNames.forEach(fileName => {
      const existingFile = existingFilesMap.get(fileName);
      resultMap.set(fileName, {
        fileName,
        exists: !!existingFile,
        fileId: existingFile?.id,
        size: existingFile?.size
      });
    });

    return resultMap;
  } catch (error) {
    console.warn("Batch file existence check failed, falling back to individual checks:", error);
    
    // Fallback: return empty map to trigger individual checks
    const fallbackMap = new Map<string, FileExistsResult>();
    fileNames.forEach(fileName => {
      fallbackMap.set(fileName, {
        fileName,
        exists: false // Assume doesn't exist to allow upload attempt
      });
    });
    return fallbackMap;
  }
}

/**
 * Advanced file matching with size comparison for better duplicate detection
 */
export async function smartFileExistsCheck(
  path: string,
  file: File
): Promise<FileExistsResult> {
  try {
    const res = await fetchClient.GET("/files", {
      params: {
        query: { 
          path, 
          name: file.name, 
          operation: "find" 
        },
      },
    });

    const existingFile = res.data?.items?.[0];
    
    if (existingFile) {
      // Check if size matches - if not, it might be a different file with same name
      const sizeMatches = existingFile.size === file.size;
      
      return {
        fileName: file.name,
        exists: true,
        fileId: existingFile.id,
        size: existingFile.size,
        // Could extend this to include hash comparison in the future
        sizeMatches
      };
    }

    return {
      fileName: file.name,
      exists: false
    };
  } catch (error) {
    console.warn(`File existence check failed for ${file.name}:`, error);
    return {
      fileName: file.name,
      exists: false // Assume doesn't exist to allow upload attempt
    };
  }
}

/**
 * Cache for file existence results with expiration
 */
class FileExistenceCache {
  private cache = new Map<string, { result: FileExistsResult; timestamp: number; expires: number }>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  set(path: string, fileName: string, result: FileExistsResult, ttl = this.DEFAULT_TTL) {
    const key = `${path}/${fileName}`;
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      expires: Date.now() + ttl
    });
  }

  get(path: string, fileName: string): FileExistsResult | null {
    const key = `${path}/${fileName}`;
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Check if expired
    if (Date.now() > cached.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.result;
  }

  clear() {
    this.cache.clear();
  }

  clearExpired() {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now > cached.expires) {
        this.cache.delete(key);
      }
    }
  }

  // Get cache statistics
  getStats() {
    const now = Date.now();
    let expired = 0;
    let valid = 0;
    
    for (const cached of this.cache.values()) {
      if (now > cached.expires) {
        expired++;
      } else {
        valid++;
      }
    }
    
    return { total: this.cache.size, valid, expired };
  }
}

export const fileExistenceCache = new FileExistenceCache();

/**
 * Batch process files for upload with optimized existence checking
 */
export async function optimizedBatchFileCheck(
  files: File[],
  path: string
): Promise<{
  toUpload: File[];
  alreadyExists: Array<{ file: File; existingFile: FileExistsResult }>;
  checkDuration: number;
}> {
  const startTime = Date.now();
  
  // Group files and check cache first
  const uncachedFiles: File[] = [];
  const cachedResults = new Map<string, FileExistsResult>();
  
  files.forEach(file => {
    const cached = fileExistenceCache.get(path, file.name);
    if (cached) {
      cachedResults.set(file.name, cached);
    } else {
      uncachedFiles.push(file);
    }
  });

  // Batch check uncached files
  const batchResults = uncachedFiles.length > 0 
    ? await batchCheckFileExists(path, uncachedFiles.map(f => f.name))
    : new Map<string, FileExistsResult>();

  // Cache the new results
  batchResults.forEach((result, fileName) => {
    fileExistenceCache.set(path, fileName, result);
  });

  // Combine cached and new results
  const allResults = new Map([...cachedResults, ...batchResults]);

  // Categorize files
  const toUpload: File[] = [];
  const alreadyExists: Array<{ file: File; existingFile: FileExistsResult }> = [];

  files.forEach(file => {
    const result = allResults.get(file.name);
    if (result?.exists) {
      alreadyExists.push({ file, existingFile: result });
    } else {
      toUpload.push(file);
    }
  });

  const checkDuration = Date.now() - startTime;
  
  console.log(`File existence check completed in ${checkDuration}ms:`, {
    total: files.length,
    toUpload: toUpload.length,
    alreadyExists: alreadyExists.length,
    cachedHits: cachedResults.size,
    newChecks: batchResults.size
  });

  return { toUpload, alreadyExists, checkDuration };
}
