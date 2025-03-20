import { appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { LOCK_FILE, VERBOSE } from "./consts";
import { dirname, extname, basename, normalize, relative } from "node:path";
import { $ } from "bun";

export interface JSONMetadata {
  media_output_directory: string;
  json_output_directory: string;
  torrent_type: string;
  category: string;
  hash: string;
  name: string;
  size: string;
}

type ColorProfile =
  | "yuv420p"
  | "yuv420p10le"
  | "yuv444p"
  | "yuv444p10le"
  | "yuv420p12le"
  | "yuv444p12le";

/**
 * @interface Metadata
 * Represents metadata for a video file.
 */
export interface Metadata {
  /**
   * @property {string} extension - The file extension without the leading dot (e.g., "mp4").
   */
  extension: string;
  /**
   * @property {string} codec - The video codec used in the file (e.g., "h264").
   */
  codec: string;
  /**
   * @property {string} colorProfile - The color profile of the video (e.g., "yuv420p").
   * 10le means 10-bit color depth.
   * 12le means 12-bit color depth.
   */
  colorProfile: ColorProfile;
  /**
   * @property {number} length - The duration of the video in seconds.
   */
  length: number;
  /**
   * @property {number} size - The size of the video file in megabytes (MB).
   */
  size: number;
  /**
   * @property {number} bitrate - The bitrate of the video in kilobits per second (Mb/s).
   */
  bitrate: number;
  /**
   * @property {string} filePath - The full path to the video file.
   */
  filePath: string;
  /**
   * @property {string} dirPath - The path to the directory containing the video file.
   */
  dirPath: string;
  /**
   * @property {string} fileName - The name of the video file including the extension.
   */
  fileName: string;
  /**
   * @property {string} baseName - The name of the video file without the extension.
   */
  baseName: string;
}

export const getVideoMetadata = async (filePath: string) => {
  try {
    const codec = (
      await $`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nokey=1:noprint_wrappers=1 "${filePath}"`.text()
    ).trim();
    const length = parseInt(
      await $`ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`.text(),
    );
    const colorProfile = (
      await $`ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nokey=1:noprint_wrappers=1 ${filePath}`.text()
    ).trim();
    const size = Bun.file(filePath).size; // in bytes
    const bitrate = (size * 8) / length / 1000 / 1000; // bitrs / length / 1000 / 1000 = Mb/s
    const extension = extname(filePath);

    const fileName = basename(filePath);
    const baseName = basename(filePath, extension);
    const dirPath = dirname(filePath);

    const sizeInMB = size / 1000 / 1000;

    const metadata: Metadata = {
      extension,
      codec,
      colorProfile: colorProfile as ColorProfile,
      length,
      size: sizeInMB,
      bitrate,
      filePath,
      dirPath,
      fileName,
      baseName,
    };

    return metadata;
  } catch (error) {
    log(`Error getting video metadata: ${error}`, "ERROR");
    return null;
  }
};

export const waitSleepHours = async () => {
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();

  if (
    currentHour >= 23 ||
    currentHour < 7 ||
    (currentHour === 7 && currentMinutes < 30)
  ) {
    // Calculate target time for 7:30 AM
    const target = new Date();
    target.setHours(7, 30, 0, 0);

    // If it's already past 7:30 AM today, set target to 7:30 AM tomorrow
    if (currentTime > target) {
      target.setDate(target.getDate() + 1);
    }

    // Add a random delay between 1 and 30 seconds
    const randomDelay = Math.floor(Math.random() * 30) + 1;
    target.setSeconds(target.getSeconds() + randomDelay);

    // Sleep until the target time
    log(`Sleeping until ${target.toLocaleString()}`);
    await Bun.sleep(target);
  }
};

export const log = async (
  message: string,
  tag: "LOG" | "WARN" | "ERROR" | "VERBOSE" = "LOG",
) => {
  if (!VERBOSE && tag === "VERBOSE") return;

  const currentTime = new Date();
  const formattedMessage = `[${currentTime.toLocaleString()}] [${tag}] ${message}\n`;

  console.log(formattedMessage.trim());
  try {
    await appendFile("transcoder-win.log", formattedMessage);
  } catch (error) {
    console.error("Error writing to log file:", error);
  }
};

export const acquireLock = async (): Promise<void> => {
  while (true) {
    try {
      // Check if lock file exists
      const lockFile = Bun.file(LOCK_FILE);
      const exists = existsSync(LOCK_FILE);

      if (!exists) {
        // Create lock file
        await Bun.write(lockFile, `Locked at ${new Date().toISOString()}`);
        log(`Lock acquired: ${LOCK_FILE}`);
        return;
      } else {
        // Lock already exists
        log(`Lock file exists, waiting 3 minutes before retry`, "WARN");
        // Wait 3 minutes (180000 ms)
        await Bun.sleep(180000);
      }
    } catch (error) {
      log(`Error while acquiring lock: ${error}`, "ERROR");
      // Still wait before retrying in case of error
      await Bun.sleep(180000);
    }
  }
};

export const releaseLock = async (): Promise<boolean> => {
  try {
    const lockFile = Bun.file(LOCK_FILE);
    const exists = existsSync(LOCK_FILE);

    if (exists) {
      await lockFile.delete();
      log(`Lock released: ${LOCK_FILE}`);
      return true;
    } else {
      log(`Lock file does not exist when attempting to release`, "WARN");
      return false;
    }
  } catch (error) {
    log(`Error releasing lock: ${error}`, "ERROR");
    return false;
  }
};
