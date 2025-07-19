# Changelog

All notable changes to this project will be documented in this file.

## Instructions
- **Every commit** with feature changes or bug fixes **MUST** update this changelog
- Include timestamp, change type, and concise description
- Format: `[YYYY-MM-DD HH:MM] [TYPE] Brief description - Why this change was needed`
- Types: `FEATURE`, `BUGFIX`, `BREAKING`, `SECURITY`, `PERFORMANCE`, `DOCS`

---

## [Unreleased]

### [2025-07-20 Current] [PERFORMANCE] Implemented upload component virtualization and optimization
- **What**: Added `react-window` for virtual scrolling, optimized Zustand selectors, and implemented threshold-based progress updates
- **Why**: Upload component exhibited significant performance degradation with large file volumes (1000+ files)
- **Impact**: Dramatically improved rendering performance, reduced memory usage, and eliminated UI lag during bulk uploads

### [2025-07-20 Current] [BUGFIX] Fixed "Cannot read properties of undefined (reading 'contains')" error
- **What**: Added comprehensive null safety checks in `UploadFileEntry` component and list rendering
- **Why**: Component tried to access file data before it was properly initialized in state
- **Impact**: Upload dialog now opens without runtime errors, preventing crashes when clicking upload button

### [2025-07-20 Current] [PERFORMANCE] Optimized file addition and state management
- **What**: Restructured `addFiles` action to ensure atomic updates and prevent race conditions
- **Why**: File IDs were being added to arrays before corresponding file objects were stored in map
- **Impact**: Eliminated undefined file data access and improved state consistency during file operations

### [2025-07-20 Current] [PERFORMANCE] Added upload progress summary with optimized calculations
- **What**: Implemented upload summary component with safe division and filtered file validation
- **Why**: Progress calculations failed with undefined files and division by zero scenarios
- **Impact**: Reliable progress tracking and summary display even with incomplete file data

### [2025-07-20 Current] [PERFORMANCE] Enhanced focus management and file input handling
- **What**: Improved `openFileSelector` with safer event handling and proper cleanup
- **Why**: Focus event listeners were causing DOM manipulation errors
- **Impact**: File selection dialog opens reliably without focus-related runtime errors

### [2025-07-20 Current] [BUGFIX] Fixed upload progress error loop
- **What**: Added safety checks in `setProgress` and `setFileUploadStatus` functions
- **Why**: Prevented "Cannot set properties of undefined" errors when files are removed during upload
- **Impact**: Upload progress updates now gracefully handle removed files without crashing

### [2025-07-20 Current] [BUGFIX] Fixed upload timer cleanup race condition  
- **What**: Improved timer cleanup in `uploadFile` function with proper abort signal handling
- **Why**: Timer continued running after file removal, causing repeated progress update attempts
- **Impact**: Upload timers are now properly cleaned up when files are removed or uploads are cancelled

---

## Example Entries (Remove this section)

### [2024-01-15 14:30] [FEATURE] Added dark mode support
- **What**: Implemented theme toggle with system preference detection
- **Why**: Users requested dark mode for better viewing experience
- **Impact**: Improved accessibility and user experience

### [2024-01-14 09:15] [BUGFIX] Fixed file upload timeout
- **What**: Increased upload timeout from 30s to 5min for large files
- **Why**: Large file uploads were failing due to insufficient timeout
- **Impact**: Users can now upload files up to 2GB successfully

### [2024-01-13 16:45] [SECURITY] Updated authentication middleware
- **What**: Added rate limiting and improved token validation
- **Why**: Prevent brute force attacks and enhance security
- **Impact**: Better protection against unauthorized access attempts