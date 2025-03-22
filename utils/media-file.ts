import { basename, extname, dirname } from "node:path";
import { getDirectorySize, log, winToWsl, wslToWin } from "../utils";
import { tryCatch } from "./try-catch";
import { $ } from "bun";
import { stat } from "node:fs/promises";

export type SourcePath = "win32" | "unix";
export type SourceStyle = "win32" | "unix";
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
  sourcePath: SourcePath; // which OS is the path from
  sourceStyle: SourceStyle; // which OS can use the path
  unixPath: string; // /mnt/c/videos/video.mp4
  winPath: string; // C:\videos\video.mp4
  dirPath: string; // /mnt/c/videos

  name: string; // video.mp4
  base: string; // video
  extension: string; // .mp4

  constructor(absolutePath: string) {
    const cleanAbsolutePath = absolutePath.replace(/^['"]|['"]$/g, "");
    const { origin, style } = getPathOrigin(cleanAbsolutePath);
    this.sourcePath = origin;
    this.sourceStyle = style;

    if (style === "win32") {
      // If the path is already in Windows format
      this.winPath = cleanAbsolutePath;
      this.unixPath = winToWsl(cleanAbsolutePath);
    } else {
      // If the path is in Unix format
      this.unixPath = cleanAbsolutePath;
      this.winPath = wslToWin(cleanAbsolutePath);
    }

    this.dirPath = dirname(this.unixPath);
    this.name = basename(cleanAbsolutePath);
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
      this.fileType()
    );
    if (fileError) {
      console.log("(media-file.ts) Caught Error:", fileError);
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
      this.fileType()
    );
    if (fileError) {
      console.log("Caught Error:", fileError);
      return;
    }
    if (fileType != "file") {
      console.log("Not a file");
      return;
    }

    const { data, error } = await tryCatch(getVideoDetails(this.unixPath));
    if (error) {
      log(`Error getting video specific metadata: ${error}`, "ERROR");
      return;
    }

    const size = round(Bun.file(this.unixPath).size / 1024 / 1024);
    const length = round(parseInt(data.length));

    let bitrate = round((size * 8) / (length * 1_000_000));
    if (data.bitrate) {
      bitrate = round(data.bitrate / 1_000_000);
    }

    return {
      colorProfile: data.colorProfile,
      codec: data.codec,
      length,
      bitrate,
      size,
    };
  };
}

const getVideoDetails = async (path: string) => {
  const result =
    await $`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,bit_rate -show_entries format=duration,bit_rate -of json "${path}"`.text();

  const data = JSON.parse(result);
  const videoStream = data.streams[0] || {};
  const format = data.format || {};

  return {
    codec: videoStream.codec_name,
    length: format.duration,
    colorProfile: videoStream.pix_fmt,
    // Try stream bitrate first, fall back to format bitrate if not available
    bitrate: videoStream.bit_rate
      ? parseInt(videoStream.bit_rate)
      : format.bit_rate
      ? parseInt(format.bit_rate)
      : null,
  };
};

// gets a path's "meta" origin
const getPathOrigin = (path: string) => {
  let origin: SourcePath = "unix";
  let style: SourceStyle = "unix";

  // Standard Windows path (e.g., D:\Games\...)
  if (/^[A-Za-z]:\\/.test(path)) {
    origin = "win32";
    style = "win32";
  }

  // Check for WSL paths (accessed from Windows)
  if (/^\\\\wsl\.localhost\\/.test(path)) {
    origin = "unix";
    style = "win32";
  }

  // Check for Unix paths
  if (/^\/(?!mnt\/[a-z]\/).+/.test(path)) {
    origin = "unix";
    style = "unix";
  }

  // Check for Unix path accessing Windows drives
  if (/^\/mnt\/[a-z]\//.test(path)) {
    origin = "win32";
    style = "unix";
  }

  return { origin, style };
};

const round = (unit: number) => {
  return Math.round(unit * 100) / 100;
};
