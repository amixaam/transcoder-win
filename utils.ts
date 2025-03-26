import { existsSync } from "node:fs";
import { appendFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DEVELOPMENT, LOCK_FILE, LOG_FILE, VERBOSE } from "./consts";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

export interface JSONMetadata {
  media_output_directory: string;
  json_output_directory: string;
  torrent_type: "new" | "episode" | "season";
  category: string;
  hash: string;
  name: string;
  size: string;
}

export const round = (unit: number) => {
  return Math.round(unit * 100) / 100;
};

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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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

  if (DEVELOPMENT) {
    log(`Development: Overwriting sleep timer`, "VERBOSE");
    return;
  }

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
  tag: "LOG" | "WARN" | "ERROR" | "VERBOSE" = "LOG",
) => {
  if (!VERBOSE && tag === "VERBOSE") return;

  const yellow = "\x1b[33m";
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const gray = "\x1b[90m";
  const reset = "\x1b[0m";

  let tagColor = yellow;
  if (tag === "LOG") tagColor = green;
  else if (tag === "WARN") tagColor = yellow;
  else if (tag === "ERROR") tagColor = red;

  const currentTime = new Date();
  const formattedMessageConsole = `${gray}[${currentTime.toLocaleString()}]${reset} ${tagColor}[${tag}]${reset} ${message}\n`;
  const formattedMessageFile = `[${currentTime.toLocaleString()}] [${tag}] ${message}\n`;

  console.log(formattedMessageConsole.trim());
  try {
    await appendFile(LOG_FILE, formattedMessageFile);
  } catch (error) {
    console.error("Error writing to log file:", error);
  }
};

dayjs.extend(duration);
export function formatSeconds(totalSeconds: number) {
  if (typeof totalSeconds !== "number" || totalSeconds < 0) {
    return "Ain't no valid seconds, boy!";
  }

  const dur = dayjs.duration(totalSeconds, "seconds");
  const hours = dur.hours();
  const minutes = dur.minutes();
  const seconds = dur.seconds();

  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
  } else if (minutes > 0) {
    parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
  } else {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

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

export function sanitizeFilename(filename: string): string {
  // Remove or replace characters that are problematic in both Windows and Linux
  let sanitized = filename.replace(/[/\\?%*:|"<>]/g, "-"); // Replace with -

  // Remove characters that are problematic in Windows
  sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");

  // Remove control characters and reserved names in Windows
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "-"); // Control characters
  sanitized = sanitized.replace(
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i,
    "-",
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
  let sanitized = dirName.replace(/\[(.*?)\]/g, "");
  sanitized = sanitized.replace(" ", "");
  sanitized = sanitized.trim();
  return sanitized;
};

export const readJsonFile = async (path: string): Promise<JSONMetadata> =>
  JSON.parse(await Bun.file(path).text());
