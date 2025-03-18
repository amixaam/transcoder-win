import { appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { LOCK_FILE } from "./consts";

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
  tag: "LOG" | "WARN" | "ERROR" = "LOG",
) => {
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

/**
 * Releases the lock by deleting the lock file.
 * @returns {Promise<boolean>} True if lock was successfully released, false otherwise
 */
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
