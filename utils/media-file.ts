import { basename, dirname, extname, join } from "node:path";
import { getDirectorySize, log, round, winToWsl, wslToWin } from "../utils";
import { tryCatch } from "./try-catch";
import { stat, rename } from "node:fs/promises";
import { $ } from "bun";

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

abstract class File {
  sourcePath: SourcePath;
  unixPath: string; // /mnt/c/videos/video.mp4
  winPath: string; // C:\videos\video.mp4
  dirPath: string; // /mnt/c/videos

  name: string; // video.mp4
  base: string; // video
  extension: string; // .mp4

  fileType: FileType;
  exists: boolean = false;

  protected constructor(absolutePath: string, type: FileType, exists: boolean) {
    this.sourcePath = getPathOrigin(absolutePath);
    const isWin = this.sourcePath === "win32";

    this.winPath = isWin ? absolutePath : wslToWin(absolutePath);
    this.unixPath = isWin ? winToWsl(absolutePath) : absolutePath;

    this.dirPath = dirname(this.unixPath);
    this.name = basename(absolutePath);
    this.extension = extname(this.name);
    this.base = basename(this.name, this.extension);

    this.fileType = type;
    this.exists = exists;
  }

  protected async ensureExists() {
    if (!this.exists) {
      const { data: _, error } = await tryCatch(stat(this.unixPath));
      if (error) {
        throw new Error("File does not exist");
      }
      this.exists = true;
    }
  }

  protected static async performInit(absolutePath: string) {
    const sourcePath = getPathOrigin(absolutePath);
    const isWin = sourcePath === "win32";

    const unixPath = isWin ? winToWsl(absolutePath) : absolutePath;

    let exists = true;
    const { data, error } = await tryCatch(stat(unixPath));
    if (error) {
      exists = false;
    }
    let type: FileType = "file";
    if (!error && data.isDirectory()) {
      type = "directory";
    }

    return { type, exists };
  }

  delete = async (): Promise<void> => {
    try {
      await Bun.file(this.unixPath).delete();
      log(`Deleted: ${this.name}`, "VERBOSE");
    } catch (error) {
      log(`Error deleting ${this.name}: ${error}`, "ERROR");
    }
  };

  rename = async (newName: string): Promise<void> => {
    const oldname = this.name;
    try {
      await rename(this.unixPath, join(this.dirPath, newName));
      this.name = newName;
      this.unixPath = join(this.dirPath, newName);
      this.winPath = wslToWin(this.unixPath);
      this.base = basename(newName, extname(newName));
      this.extension = extname(newName);
      log(`Renamed: ${oldname} to ${newName}`, "VERBOSE");
    } catch (error) {
      log(`Error renaming ${oldname} to ${newName}: ${error}`, "ERROR");
    }
  };

  abstract getDetails(): Promise<any | undefined>;
}

export class GenericFile extends File {
  private constructor(absolutePath: string, type: FileType, exists: boolean) {
    super(absolutePath, type, exists);
  }

  public static async init(absolutePath: string) {
    const { type, exists } = await this.performInit(absolutePath);
    return new GenericFile(absolutePath, type, exists);
  }

  getDetails = async (): Promise<GenericMetadata | undefined> => {
    await this.ensureExists();

    if (this.fileType === "file") {
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
  private constructor(absolutePath: string, type: FileType, exists: boolean) {
    super(absolutePath, type, exists);
  }

  public static async init(absolutePath: string) {
    const { type, exists } = await this.performInit(absolutePath);
    if (type === "directory") {
      throw new Error("Cannot initialize MediaFile with a directory");
    }
    return new MediaFile(absolutePath, type, exists);
  }

  getDetails = async (): Promise<Metadata | undefined> => {
    await this.ensureExists();

    // run ffprobe calls concurrently
    const { data: results, error: promiseError } = await tryCatch(
      Promise.all([
        getVideoFormatDetails(this.unixPath), // gets duration, size, overall bitrate
        getVideoStreamDetails(this.unixPath), // gets codec, color profile
      ]),
    );

    if (promiseError || !results) {
      log(
        `Error running ffprobe concurrently for ${this.base}: ${promiseError}`,
        "ERROR",
      );
      return undefined;
    }

    // destructure results (order matches Promise.all array)
    const [formatData, streamData] = results;

    const sizeInBytes = formatData.size ?? (await Bun.file(this.unixPath).size); // use ffprobe size, fallback to Bun.file.size
    const lengthInSeconds = formatData.duration;
    const bitrateInBps = formatData.bit_rate;

    if (lengthInSeconds === undefined || lengthInSeconds <= 0) {
      log(`Invalid or zero duration reported for ${this.base}`, "ERROR");
      return undefined;
    }
    if (sizeInBytes <= 0) {
      log(`Invalid or zero size reported for ${this.base}`, "ERROR");
      return undefined;
    }

    let bitrateInMbps: number;
    if (bitrateInBps !== undefined && bitrateInBps > 0) {
      bitrateInMbps = round(bitrateInBps / 1_000_000);
    } else {
      log(
        `ffprobe did not report format bit_rate for ${this.base}, calculating manually.`,
        "WARN",
      );
      // bytes*8 -> bits; /sec -> bps; /1_000_000 -> Mbps
      bitrateInMbps = round((sizeInBytes * 8) / lengthInSeconds / 1_000_000);
    }

    const sizeInMB = round(sizeInBytes / 1024 / 1024);

    const codec = streamData?.codec_name ?? "hevc";
    const colorProfile = streamData?.pix_fmt;

    return {
      colorProfile: colorProfile as ColorProfile,
      codec: codec,
      length: round(lengthInSeconds),
      bitrate: bitrateInMbps,
      size: sizeInMB,
    };
  };
}

interface VideoFormatDetails {
  duration?: number; // seconds
  size?: number; // bytes
  bit_rate?: number; // bps
}

const getVideoFormatDetails = async (
  path: string,
): Promise<VideoFormatDetails> => {
  try {
    const result =
      await $`ffprobe -v error -show_entries format=duration,size,bit_rate -of json "${path}"`.text();

    const data = JSON.parse(result);

    if (!data || !data.format) {
      log(`ffprobe failed to return format data for ${path}`, "WARN");
      throw new Error("ffprobe failed to return format data");
    }

    const format = data.format;

    return {
      duration: format.duration ? parseFloat(format.duration) : undefined,
      size: format.size ? parseInt(format.size, 10) : undefined,
      bit_rate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
    };
  } catch (error: any) {
    log(
      `Error running ffprobe for format details on ${path}: ${error.message || error}`,
      "ERROR",
    );
    throw new Error("Error running ffprobe for format details:", error);
  }
};

// --- Add this interface ---
interface VideoStreamDetails {
  codec_name?: string;
  pix_fmt?: ColorProfile; // Use your ColorProfile type
}

// --- Add this new helper function ---
const getVideoStreamDetails = async (
  path: string,
): Promise<VideoStreamDetails> => {
  try {
    // Select only the first video stream (v:0) and get codec_name, pix_fmt
    const result =
      await $`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt -of json "${path}"`.text();

    const data = JSON.parse(result);

    // Basic validation
    if (!data || !data.streams || data.streams.length === 0) {
      log(`ffprobe failed to return video stream data for ${path}`, "WARN");
      throw new Error("ffprobe failed to return video stream data");
    }

    const stream = data.streams[0]; // Get the first (and only selected) stream

    return {
      codec_name: stream.codec_name,
      pix_fmt: stream.pix_fmt, // Assuming pix_fmt maps directly to your ColorProfile type
    };
  } catch (error: any) {
    log(
      `Error running ffprobe for stream details on ${path}: ${error.message || error}`,
      "ERROR",
    );
    // Re-throw to be caught by Promise.all or the caller
    throw new Error("Error running ffprobe for stream details:", error);
  }
};
