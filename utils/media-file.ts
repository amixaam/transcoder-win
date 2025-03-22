import { basename, extname, dirname } from "node:path";
import { getDirectorySize, log, winToWsl } from "../utils";
import { tryCatch } from "./try-catch";

// @ts-ignore
import ffprobe, { type FFProbeResult } from "ffprobe";
// @ts-ignore
import ffprobeStatic from "ffprobe-static";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";

export type SourcePath = "win32" | "unix";
export type FileType = "file" | "directory";

export type ColorProfile =
  | "yuv420p"
  | "yuv420p10le"
  | "yuv444p"
  | "yuv444p10le"
  | "yuv420p12le"
  | "yuv444p12le";

export type GenericMetadata = {
  size: number; // 49.20 (MB)
};

export type Metadata = GenericMetadata & {
  colorProfile: ColorProfile; // yuv420p
  codec: string; // av1
  bitrate: number; // 1.40 (Mb/s)
  length: number; // 281 (seconds)
};

abstract class File {
  sourcePath: SourcePath;
  unixPath: string; // /mnt/c/videos/video.mp4
  winPath: string; // C:\videos\video.mp4
  dirPath: string; // /mnt/c/videos

  name: string; // video.mp4
  base: string; // video
  extension: string; // .mp4

  constructor(absolutePath: string) {
    this.sourcePath = getPathOrigin(absolutePath);
    const isWin = this.sourcePath === "win32";

    this.winPath = isWin ? absolutePath : winToWsl(absolutePath);
    this.unixPath = isWin ? winToWsl(absolutePath) : absolutePath;

    this.dirPath = dirname(this.unixPath);
    this.name = basename(absolutePath);
    this.extension = extname(this.name);
    this.base = basename(this.name, this.extension);
  }

  exists = async (): Promise<boolean> => {
    try {
      await stat(this.unixPath);
      return true;
    } catch (error) {
      return false;
    }
  };

  fileType = async (): Promise<FileType> => {
    const stats = await stat(this.unixPath);

    if (stats.isDirectory()) {
      return "directory";
    }
    return "file";
  };

  abstract getDetails(): Promise<any | undefined>;
}

export class GenericFile extends File {
  constructor(absolutePath: string) {
    super(absolutePath);
  }
  getDetails = async (): Promise<GenericMetadata | undefined> => {
    const { data: fileType, error: fileError } = await tryCatch<FileType>(
      this.fileType(),
    );
    if (fileError) {
      console.log("Caught Error:", fileError);
      return;
    }

    if (fileType === "file") {
      const size = round(Bun.file(this.unixPath).size / 1000 / 1000);
      return {
        size,
      };
    } else {
      const size = round((await getDirectorySize(this.unixPath)) / 1000 / 1000);
      return {
        size,
      };
    }
  };
}

export class MediaFile extends File {
  constructor(absolutePath: string) {
    super(absolutePath);
  }
  getDetails = async (): Promise<Metadata | undefined> => {
    const { data: fileType, error: fileError } = await tryCatch<FileType>(
      this.fileType(),
    );
    if (fileError) {
      console.log("Caught Error:", fileError);
      return;
    }
    if (fileType != "file") {
      console.log("Not a file");
      return;
    }

    const { data, error } = await tryCatch<FFProbeResult>(
      ffprobe(this.unixPath, {
        path: ffprobeStatic.path,
      }),
    );
    if (error) {
      log(`Error getting video specific metadata: ${error}`, "ERROR");
      return;
    }

    const video = data.streams[0];
    const size = round(Bun.file(this.unixPath).size / 1000 / 1000);
    const bitrate = round(video.bit_rate / 1000 / 1000);
    const length = round(parseInt(video.duration));

    return {
      colorProfile: video.pix_fmt,
      codec: video.codec_name,
      length,
      bitrate,
      size,
    };
  };
}

// gets a path's "meta" origin
const getPathOrigin = (path: string): SourcePath => {
  if (
    /^[A-Za-z]:\\/.test(path) || // Standard Windows path (e.g., D:\Games\...)
    /^\/[A-Za-z]\//.test(path) // Git Bash style Windows path (e.g., /d/Games/...)
  ) {
    return "win32";
  }

  // Check for WSL paths (accessed from Windows)
  if (/^\\\\wsl\.localhost\\/.test(path)) {
    return "unix";
  }

  // Check for Unix paths
  if (/^\/(?!mnt\/[a-z]\/).+/.test(path)) {
    return "unix";
  }

  // Check for Unix path accessing Windows drives
  if (/^\/mnt\/[a-z]\//.test(path)) {
    return "win32"; // These are Windows drives accessed from WSL
  }

  // Default to unix if nothing matches
  return "unix";
};

const round = (unit: number) => {
  return Math.round(unit * 100) / 100;
};
