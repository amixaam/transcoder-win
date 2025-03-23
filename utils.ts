import { existsSync } from "node:fs";
import { appendFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DEVELOPMENT,
  LOCK_FILE,
  LOCK_FILE_SLEEP_TIME,
  LOG_FILE,
  SKIP_SLEEP,
  SLEEP_FROM_H,
  SLEEP_TO_H,
  SLEEP_TO_M,
  VERBOSE,
} from "./consts";

export interface JSONMetadata {
  media_output_directory: string;
  json_output_directory: string;
  torrent_type: "new" | "episode" | "season";
  category: string;
  hash: string;
  name: string;
  size: string;
}

export async function getDirectorySize(directoryPath: string): Promise<number> {
  let totalSize = 0;

  const items = await readdir(directoryPath);

  for (const item of items) {
    const itemPath = join(directoryPath, item);
    const stats = await stat(itemPath);

    if (stats.isDirectory()) {
      totalSize += await getDirectorySize(itemPath);
    } else if (stats.isFile()) {
      totalSize += stats.size;
    }
  }

  return totalSize;
}

export function formatMegaBytes(megabytes: number): string {
  if (megabytes === 0) return "0 MB";

  const k = 1024;
  const sizes = ["MB", "GB", "TB", "PB", "EB"]; // Start with MB
  let i = 0;

  let bytes = megabytes * k * k; // Convert MB to Bytes

  if (bytes >= k * k) {
    i = Math.floor(Math.log(bytes) / Math.log(k)) - 1; // Subtract 2, since we started at MB
  }

  return parseFloat((bytes / Math.pow(k, i + 2)).toFixed(2)) + " " + sizes[i]; // +2 because we are converting from MB
}

// Handle paths like /mnt/d/Games/... => D:\Games\...
// Handle paths like /home/roberts/... => \\wsl.localhost\Ubuntu-24.04\home\roberts\...
export const wslToWin = (wslPath: string): string => {
  // Handle empty path
  if (!wslPath) {
    return "";
  }

  // Handle /mnt/DRIVE/path => DRIVE:\path
  const driveMatch = wslPath.match(/^\/mnt\/([a-zA-Z])(.*)$/);
  if (driveMatch) {
    const [, drive, rest] = driveMatch;
    return `${drive!.toUpperCase()}:${rest!.replace(/\//g, "\\")}`;
  }

  // Handle Linux paths like /home/user/... => \\wsl.localhost\DISTRO\home\user\...
  if (wslPath.startsWith("/")) {
    // Assume Ubuntu-24.04 as the default distro
    const distro = "Ubuntu-24.04";
    return `\\\\wsl.localhost\\${distro}${wslPath.replace(/\//g, "\\")}`;
  }

  // Return original path if it doesn't match any pattern
  return wslPath;
};

// Handle paths like D:\Games\... => /mnt/d/Games/...
// Handle paths like \\wsl.localhost\Ubuntu-24.04\home\roberts\... => /home/roberts/...
export const winToWsl = (winPath: string): string => {
  // Handle empty path
  if (!winPath) {
    return "";
  }

  // Handle DRIVE:\path => /mnt/DRIVE/path
  const driveMatch = winPath.match(/^([a-zA-Z]):(.*)$/);
  if (driveMatch) {
    const [, drive, rest] = driveMatch;
    return `/mnt/${drive!.toLowerCase()}${rest!.replace(/\\/g, "/")}`;
  }

  // Handle UNC WSL paths \\wsl.localhost\DISTRO\path => /path
  const wslUncMatch = winPath.match(/^\\\\wsl\.localhost\\([^\\]+)(.*)$/);
  if (wslUncMatch) {
    const [, , path] = wslUncMatch;
    return path!.replace(/\\/g, "/");
  }

  // Return original path if it doesn't match any pattern
  return winPath;
};

export const waitSleepHours = async () => {
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();

  if (DEVELOPMENT || SKIP_SLEEP) {
    log(`Ignoring sleep timer...`, "VERBOSE");
    return;
  }

  if (
    currentHour >= SLEEP_FROM_H ||
    currentHour < SLEEP_TO_H ||
    (currentHour === SLEEP_TO_H && currentMinutes < SLEEP_TO_M)
  ) {
    // Calculate target time for 7:30 AM
    const target = new Date();
    target.setHours(SLEEP_TO_H, SLEEP_TO_M, 0, 0);

    // If it's already past 7:30 AM today, set target to 7:30 AM tomorrow
    if (currentTime > target) {
      target.setDate(target.getDate() + 1);
    }

    // Add a random delay between 1 and 40 seconds
    const randomDelay = Math.floor(Math.random() * 40) + 1;
    target.setSeconds(target.getSeconds() + randomDelay);

    // Sleep until the target time
    log(`Sleeping until ${target.toLocaleString()}`);
    await Bun.sleep(target);
  }
};

export const getPerformance = (startTime: number) => {
  const elapsedSeconds = (performance.now() - startTime) / 1000;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = Math.floor(elapsedSeconds % 60);
  const timeString = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  return timeString;
};

export const log = async (
  message: string,
  tag: "LOG" | "WARN" | "ERROR" | "VERBOSE" = "LOG"
) => {
  if (!VERBOSE && tag === "VERBOSE") return;

  const yellow = "\x1b[33m";
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const cyan = "\x1b[36m";
  const reset = "\x1b[0m";

  let tagColor = cyan;
  if (tag === "LOG") tagColor = green;
  else if (tag === "WARN") tagColor = yellow;
  else if (tag === "ERROR") tagColor = red;

  const currentTime = new Date();
  const formattedMessageConsole = `[${green}${currentTime.toLocaleString()}${reset}] [${tagColor}${tag}${reset}] ${message}\n`;
  const formattedMessageFile = `[${currentTime.toLocaleString()}] [${tag}] ${message}\n`;

  console.log(formattedMessageConsole.trim());
  try {
    await appendFile(LOG_FILE, formattedMessageFile);
  } catch (error) {
    console.error("Error writing to log file:", error);
  }
};

export const acquireLock = async (): Promise<void> => {
  const waitForSeconds = LOCK_FILE_SLEEP_TIME * 60 * 1000;

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
        log(
          `${Bun
            .argv[3]!} Lock file exists, waiting ${LOCK_FILE_SLEEP_TIME} minutes before retry`,
          "VERBOSE"
        );
        await Bun.sleep(waitForSeconds);
      }
    } catch (error) {
      log(`Error while acquiring lock: ${error}`, "ERROR");
      // Still wait before retrying in case of error
      await Bun.sleep(waitForSeconds);
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

export function sanitizeFilename(filename: string): string {
  // Remove or replace characters that are problematic in both Windows and Linux
  let sanitized = filename.replace(/[/\\?%*:|"<>]/g, "-"); // Replace with -

  // Remove characters that are problematic in Windows
  sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");

  // Remove control characters and reserved names in Windows
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "-"); // Control characters
  sanitized = sanitized.replace(
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i,
    "-"
  ); // Reserved names

  // Remove or trim leading and trailing spaces
  sanitized = sanitized.trim();

  // Replace multiple spaces with a single space
  sanitized = sanitized.replace(/\s+/g, " ");

  // Limit the filename length to avoid issues with older systems
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

export const clearTags = (dirName: string) => {
  let sanitized = dirName.replace(/\[(.*?)\]/g, ""); // Remove square brackets and their contents
  sanitized = sanitized.replace(/\((.*?)\)/g, ""); // Remove parentheses and their contents
  sanitized = sanitized.replace(/\s+/g, " "); // Replace multiple spaces with single space
  sanitized = sanitized.trim();
  return sanitized;
};

export const readJsonFile = async (path: string): Promise<JSONMetadata> =>
  JSON.parse(await Bun.file(path).text());
