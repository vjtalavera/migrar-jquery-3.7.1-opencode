/// <reference types="vite/client" />

import 'react';

declare module 'react' {
  interface InputHTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    webkitdirectory?: string | boolean | undefined;
    directory?: string | boolean | undefined;
  }
}

interface FileSystemEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

interface FileReader {
  readAsText(blob: Blob): void;
  result: string | ArrayBuffer | null;
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null;
}

interface DataTransferItem {
  getAsEntry(): FileSystemEntry | null;
  webkitGetAsEntry(): FileSystemEntry | null;
}
