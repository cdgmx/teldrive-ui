import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ColorsLight, FbIcon, useIconData } from "@tw-material/file-browser";
import { Button, Listbox, ListboxItem } from "@tw-material/react";
import IcOutlineCheckCircle from "~icons/ic/outline-check-circle";
import IcRoundClose from "~icons/ic/round-close";
import IcRoundErrorOutline from "~icons/ic/round-error-outline";
import IconParkOutlineCloseOne from "~icons/icon-park-outline/close-one";
import IconParkOutlineDownC from "~icons/icon-park-outline/down-c";
import IconParkOutlineUpC from "~icons/icon-park-outline/up-c";
import LineMdCancel from "~icons/line-md/cancel";
import clsx from "clsx";
import md5 from "md5";
import pLimit from "p-limit";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { FixedSizeList } from "react-window";

import useSettings from "@/hooks/use-settings";
import { scrollbarClasses } from "@/utils/classes";
import { filesize, formatTime, zeroPad } from "@/utils/common";
import { $api, fetchClient } from "@/utils/api";
import { useSession } from "@/utils/query-options";
import { FileUploadStatus, useFileUploadStore } from "@/utils/stores";
import { optimizedBatchFileCheck, fileExistenceCache } from "@/utils/upload-helpers";
import type { components } from "@/lib/api";
import { useSearch } from "@tanstack/react-router";

type UploadParams = Record<string, string | number | boolean | undefined>;

const uploadChunk = <T extends {}>(
  url: string,
  body: Blob,
  params: UploadParams,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) => {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const uploadUrl = new URL(url);

    for (const key of Object.keys(params)) {
      uploadUrl.searchParams.append(key, String(params[key]));
    }

    signal.addEventListener("abort", () => xhr.abort());

    xhr.open("POST", uploadUrl.href, true);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.responseType = "json";

    xhr.upload.onprogress = (event) =>
      event.lengthComputable && onProgress((event.loaded / event.total) * 100);

    xhr.onload = () => {
      onProgress(100);
      resolve(xhr.response as T);
    };

    xhr.onabort = () => {
      reject(new Error("Upload aborted"));
    };
    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };
    xhr.send(body);
  });
};

const uploadFile = async (
  file: File,
  path: string,
  chunkSize: number,
  userId: number,
  concurrency: number,
  encyptFile: boolean,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  onCreate: (payload: any) => Promise<void>,
) => {
  const fileName = file.name;

  // Check cache first for recent existence check
  const existingFileCheck = fileExistenceCache.get(path, fileName);
  
  // Only do network check if not recently cached
  if (!existingFileCheck) {
    try {
      const res = (
        await fetchClient.GET("/files", {
          params: {
            query: { path, name: fileName, operation: "find" },
          },
        })
      ).data;

      const exists = Boolean(res && res.items.length > 0);
      
      // Cache the result for 5 minutes
      fileExistenceCache.set(path, fileName, {
        fileName,
        exists,
        fileId: res?.items?.[0]?.id,
        size: res?.items?.[0]?.size
      });
      
      if (exists) {
        throw new Error("File already exists");
      }
    } catch (error) {
      // If it's our "file exists" error, re-throw it
      if (error instanceof Error && error.message === "File already exists") {
        throw error;
      }
      // For other errors (network issues, etc.), log but continue with upload
      console.warn(`File existence check failed for ${fileName}, continuing with upload:`, error);
    }
  } else if (existingFileCheck.exists) {
    throw new Error("File already exists");
  }

  const totalParts = Math.ceil(file.size / chunkSize);

  const limit = pLimit(concurrency);

  const uploadId = md5(
    `${path}/${fileName}${file.size.toString()}${formatTime(file.lastModified)}${userId}`,
  );

  const url = `${window.location.origin}/api/uploads/${uploadId}`;

  const uploadedParts = (
    await fetchClient.GET("/uploads/{id}", {
      params: {
        path: {
          id: uploadId,
        },
      },
    })
  ).data!;

  let channelId = 0;

  if (uploadedParts.length > 0) {
    channelId = uploadedParts[0].channelId;
  }

  const partUploadPromises: Promise<components["schemas"]["UploadPart"]>[] = [];

  const partProgress: number[] = [];

  for (let partIndex = 0; partIndex < totalParts; partIndex++) {
    if (uploadedParts?.findIndex((item) => item.partNo === partIndex + 1) > -1) {
      partProgress[partIndex] = 100;
      continue;
    }

    partUploadPromises.push(
      limit(() =>
        (async () => {
          const start = partIndex * chunkSize;

          const end = Math.min(partIndex * chunkSize + chunkSize, file.size);

          const fileBlob = totalParts > 1 ? file.slice(start, end) : file;

          const partName =
            totalParts > 1 ? `${fileName}.part.${zeroPad(partIndex + 1, 3)}` : fileName;

          const params = {
            partName,
            fileName,
            partNo: partIndex + 1,
            encrypted: encyptFile,
            channelId,
          } as const;

          const asset = await uploadChunk<components["schemas"]["UploadPart"]>(
            url,
            fileBlob,
            params,
            signal,
            (progress) => {
              partProgress[partIndex] = progress;
            },
          );
          return asset;
        })(),
      ),
    );
  }

  let animationFrameId: number | null = null;
  let lastUpdateTimestamp = Date.now();

  const requestProgressUpdate = (onProgress: (progress: number) => void, getProgress: () => number) => {
    if (Date.now() - lastUpdateTimestamp < 1000) {
      return;
    }

    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(() => {
        onProgress(getProgress());
        lastUpdateTimestamp = Date.now();
        animationFrameId = null;
      });
    }
  };

  const timer = setInterval(() => {
    requestProgressUpdate(onProgress, () => {
      const totalProgress = partProgress.reduce((sum, progress) => sum + progress, 0);
      return totalProgress / totalParts;
    });
  }, 1000);

  const cleanup = () => {
    limit.clearQueue();
    clearInterval(timer);
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  };

  signal.addEventListener("abort", cleanup);

  try {
    const parts = await Promise.all(partUploadPromises);

    const uploadParts = uploadedParts
      .concat(parts)
      .sort((a, b) => a.partNo - b.partNo)
      .map((item) => ({ id: item.partId, salt: item.salt }));

    const payload = {
      name: fileName,
      mimeType: file.type ?? "application/octet-stream",
      type: "file",
      parts: uploadParts,
      size: file.size,
      path: path ? path : "/",
      encrypted: encyptFile,
      channelId,
    } as const;

    await onCreate(payload);
    await fetchClient.DELETE("/uploads/{id}", {
      params: {
        path: {
          id: uploadId,
        },
      },
    });
  } finally {
    cleanup();
  }
};

const UploadFileEntry = memo(({ id }: { id: string }) => {
  const fileData = useFileUploadStore((state) => state.fileMap[id]);
  const removeFile = useFileUploadStore((state) => state.actions.removeFile);
  
  if (!fileData || !fileData.file) {
    return null;
  }
  
  const { status, progress, file } = fileData;
  const { name, size } = file;

  const { icon, colorCode } = useIconData({ name, isDir: false, id: "" });

  const progresStats = useMemo(() => {
    if (status === FileUploadStatus.UPLOADING) {
      return `${filesize((progress / 100) * size)} of ${filesize(size)}`;
    }
    if (status === FileUploadStatus.UPLOADED) {
      return `${filesize(size)}`;
    }
    return "";
  }, [progress, size, status]);

  const renderIcon = useCallback(() => {
    if (status === FileUploadStatus.NOT_STARTED || status === FileUploadStatus.UPLOADING) {
      return (
        <Button onPress={() => removeFile(id)} className="text-inherit" variant="text" isIconOnly>
          <IcRoundClose />
        </Button>
      );
    }
    if (status === FileUploadStatus.UPLOADED) {
      return (
        <Button className="text-green-600" variant="text" isIconOnly>
          <IcOutlineCheckCircle />
        </Button>
      );
    }
    if (status === FileUploadStatus.FAILED) {
      return (
        <Button className="text-red-600" variant="text" isIconOnly>
          <IcRoundErrorOutline />
        </Button>
      );
    }
    return (
      <Button className="text-gray-800" variant="text" isIconOnly>
        <LineMdCancel />
      </Button>
    );
  }, [status, id, removeFile]);

  return (
    <div className="flex size-full items-center gap-3">
      <div
        className="size-8 grid rounded-lg shrink-0"
        style={{ backgroundColor: `${ColorsLight[colorCode]}1F` }}
      >
        <FbIcon
          className="size-5 text-center min-w-5 place-self-center text-primary"
          icon={icon}
          style={{
            color: ColorsLight[colorCode],
          }}
        />
      </div>
      <div className="flex flex-col gap-2 truncate flex-1">
        <p title={name} className="truncate text-base font-normal">
          {name}
        </p>
        {progresStats && (
          <>
            <div
              style={{ width: `${progress}%` }}
              className="bg-primary h-0.5 w-0 transition-[width] duration-300 ease-in"
            />
            <p className="text-sm font-normal">{progresStats}</p>
          </>
        )}
      </div>
      {renderIcon()}
    </div>
  );
});

export const Upload = ({ queryKey }: { queryKey: any[] }) => {
  const { fileIds, currentFileId, collapse, fileDialogOpen, uploadOpen, activeUploads, actions } = useFileUploadStore(
    useShallow((state) => ({
      fileIds: state.filesIds,
      currentFileId: state.currentFileId,
      collapse: state.collapse,
      actions: state.actions,
      fileDialogOpen: state.fileDialogOpen,
      uploadOpen: state.uploadOpen,
      activeUploads: state.activeUploads,
    })),
  );

  const currentFile = useFileUploadStore((state) => state.fileMap[currentFileId]);
  
  const uploadStats = useFileUploadStore(
    useShallow((state) => {
      const validFiles = state.filesIds.filter(id => state.fileMap[id]);
      return {
        total: state.filesIds.length,
        completed: validFiles.filter(
          (id) => state.fileMap[id]?.status === FileUploadStatus.UPLOADED,
        ).length,
        failed: validFiles.filter((id) => state.fileMap[id]?.status === FileUploadStatus.FAILED)
          .length,
      };
    }),
  );

  const { settings } = useSettings();

  const [session] = useSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { path } = useSearch({ from: "/_authed/$view" });

  const openFileSelector = useCallback(() => {
    if (fileInputRef?.current) {
      fileInputRef.current.click();
      // Use setTimeout to ensure the focus event handler is added after the current execution
      setTimeout(() => {
        const handleFocus = () => {
          actions.setFileDialogOpen(false);
          window.removeEventListener("focus", handleFocus);
        };
        window.addEventListener("focus", handleFocus, { once: true });
      }, 0);
    }
  }, [actions]);

  useEffect(() => {
    if (fileDialogOpen) {
      openFileSelector();
    }
  }, [fileDialogOpen]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
      ? Array.from(event.target.files).filter((f) => f.size > 0)
      : [];
      
    if (files.length === 0) return;

    // Show immediate feedback for large batches
    if (files.length > 50) {
      toast.loading(`Checking ${files.length} files for duplicates...`, { id: 'batch-check' });
    }

    try {
      // Use optimized batch checking for better performance
      const { toUpload, alreadyExists, checkDuration } = await optimizedBatchFileCheck(
        files, 
        path || "/"
      );

      // Dismiss loading toast
      toast.dismiss('batch-check');

      // Show results to user
      if (alreadyExists.length > 0) {
        toast.success(
          `Found ${toUpload.length} new files to upload. ${alreadyExists.length} files already exist.`,
          { duration: 4000 }
        );
      } else if (toUpload.length > 0) {
        toast.success(`Ready to upload ${toUpload.length} files`);
      }

      // Log performance metrics
      console.log(`Batch file check completed in ${checkDuration}ms for ${files.length} files`);

      // Only add files that don't exist
      if (toUpload.length > 0) {
        actions.addFiles(toUpload);
      }
      
      // Optionally show existing files dialog for user decision
      if (alreadyExists.length > 0) {
        // Could implement a dialog here to let user choose to overwrite
        console.log('Files already exist:', alreadyExists.map(item => item.file.name));
      }

    } catch (error) {
      toast.dismiss('batch-check');
      console.error('Batch file check failed:', error);
      
      // Fallback: add all files and let individual checks handle duplicates
      toast.error('Could not check for duplicates, will check during upload');
      actions.addFiles(files);
    }
  }, [actions, path]);

  const queryClient = useQueryClient();

  // Debounced query invalidation to prevent excessive refreshes
  const debouncedInvalidateQueries = useRef<NodeJS.Timeout>();
  
  const invalidateQueriesDebounced = useCallback(() => {
    if (debouncedInvalidateQueries.current) {
      clearTimeout(debouncedInvalidateQueries.current);
    }
    debouncedInvalidateQueries.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey });
    }, 1000); // Wait 1 second before invalidating to batch multiple completions
  }, [queryClient, queryKey]);

  // Modified create file mutation without immediate invalidation
  const creatFileWithoutInvalidation = $api.useMutation("post", "/files");

  // Handle concurrent uploads with improved state management
  useEffect(() => {
    const maxConcurrent = Number(settings.maxConcurrentFiles) || 3;
    
    // Find files ready to upload
    const readyFiles = fileIds.filter(id => {
      const file = useFileUploadStore.getState().fileMap[id];
      return file && file.status === FileUploadStatus.NOT_STARTED;
    });

    // Calculate available slots
    const availableSlots = maxConcurrent - activeUploads.size;
    
    if (readyFiles.length > 0 && availableSlots > 0) {
      // Start uploads for available slots
      const filesToStart = readyFiles.slice(0, availableSlots);
      
      filesToStart.forEach(async (fileId) => {
        const file = useFileUploadStore.getState().fileMap[fileId];
        if (!file) return;

        // Mark as uploading and add to active uploads
        actions.setFileUploadStatus(fileId, FileUploadStatus.UPLOADING);
        actions.addActiveUpload(fileId);

        try {
          await uploadFile(
            file.file,
            path || "/",
            Number(settings.splitFileSize),
            session?.userId as number,
            Number(settings.uploadConcurrency),
            Boolean(settings.encryptFiles),
            file.controller.signal,
            (progress) => actions.setProgress(fileId, progress),
            async (payload) => {
              // Use the non-invalidating mutation
              await creatFileWithoutInvalidation.mutateAsync({
                body: payload,
              });
            },
          );
          
          actions.setFileUploadStatus(fileId, FileUploadStatus.UPLOADED);
          actions.removeActiveUpload(fileId);
          
          // Trigger debounced query invalidation
          invalidateQueriesDebounced();
          
        } catch (err: any) {
          toast.error(`Upload failed for ${file.file.name}: ${err.message}`);
          actions.setFileUploadStatus(fileId, FileUploadStatus.FAILED);
          actions.removeActiveUpload(fileId);
        }
      });
    }
  }, [fileIds, activeUploads.size, path, settings.splitFileSize, settings.uploadConcurrency, settings.encryptFiles, settings.maxConcurrentFiles, session?.userId, actions, creatFileWithoutInvalidation, invalidateQueriesDebounced]);

  // Cleanup debounced timer on unmount
  useEffect(() => {
    return () => {
      if (debouncedInvalidateQueries.current) {
        clearTimeout(debouncedInvalidateQueries.current);
      }
    };
  }, []);

  return (
    <div className="fixed right-10 bottom-10">
      <input
        className="opacity-0"
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
      />
      {fileIds.length > 0 && (
        <div className="max-w-xs">
          <div
            className={clsx(
              "shadow-md w-full flex flex-col gap-2",
              "px-4 py-2 text-sm font-medium bg-surface-container min-h-12",
              collapse ? "rounded-lg" : "rounded-t-lg",
            )}
          >
            <div className="flex items-center">
              <span>Upload</span>
              <span className="text-label-medium ml-2">
                {fileIds.length} {fileIds.length > 1 ? "files" : "file"}
                {activeUploads.size > 0 && (
                  <span className="text-primary ml-1">
                    ({activeUploads.size} active)
                  </span>
                )}
              </span>
              <div className="inline-flex gap-2 ml-auto">
                <Button
                  variant="text"
                  className="text-inherit"
                  isIconOnly
                  onPress={actions.toggleCollapse}
                >
                  {collapse ? <IconParkOutlineUpC /> : <IconParkOutlineDownC />}
                </Button>
                <Button
                  variant="text"
                  className="text-inherit"
                  isIconOnly
                  onPress={actions.cancelUpload}
                >
                  <IconParkOutlineCloseOne />
                </Button>
              </div>
            </div>
            <div className="p-2 border-b border-outline-variant">
              <div className="flex justify-between mb-1 text-label-medium">
                <span>
                  Completed: {uploadStats.completed}/{uploadStats.total}
                </span>
                {uploadStats.failed > 0 && <span>Failed: {uploadStats.failed}</span>}
              </div>
              <div className="h-1 bg-surface-container-highest rounded">
                <div
                  className="h-full bg-primary rounded"
                  style={{
                    width: `${uploadStats.total > 0 ? (uploadStats.completed / uploadStats.total) * 100 : 0}%`,
                    transition: "width 300ms ease-in",
                  }}
                />
              </div>
            </div>
          </div>
          <div
            className={clsx(
              "max-w-xs rounded-none rounded-b-lg dark:bg-surface-container-lowest bg-surface shadow-md",
              "transition-[max-height] duration-300 ease-in-out select-none",
              collapse ? "max-h-0 overflow-hidden" : "max-h-80 overflow-y-auto",
            )}
          >
            {fileIds.length > 100 ? (
              <FixedSizeList
                height={collapse ? 0 : 320}
                itemCount={fileIds.length}
                itemSize={64}
                width={320}
                overscanCount={5}
                className={scrollbarClasses}
              >
                {({ index, style }) => {
                  const id = fileIds[index];
                  if (!id) return null;
                  
                  return (
                    <div style={style} className="px-4 py-2">
                      <UploadFileEntry id={id} />
                    </div>
                  );
                }}
              </FixedSizeList>
            ) : (
              <Listbox
                aria-label="Upload Files"
                className={clsx(scrollbarClasses, "max-h-80 overflow-y-auto")}
              >
                {fileIds.filter(Boolean).map((id) => (
                  <ListboxItem
                    className="data-[hover=true]:bg-transparent px-0"
                    key={id}
                    textValue={id}
                  >
                    <UploadFileEntry id={id} />
                  </ListboxItem>
                ))}
              </Listbox>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
