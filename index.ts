import { $ } from "bun";
import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { exit } from "node:process";
import { DEVELOPMENT, METADATA_DIR, TEMP_DIR } from "./consts";
import { exportSubtitles } from "./export-subs";
import { transcodeVideos } from "./transcode-videos";
import { transferFiles } from "./transfer-files";
import {
  acquireLock,
  clearTags,
  formatBytes,
  getDirectorySize,
  getPerformance,
  log,
  releaseLock,
  sanitizeFilename,
  waitSleepHours,
  winToWsl,
  type JSONMetadata,
} from "./utils";

// An All-in-One solution for Windows users who want to export subs, transcode their media files to .mp4 and upload them to a server AUTOMATICALLY.
// CHECK CONSTS.TS FOR CONFIGURATION OPTIONS.

// USAGE: bun run index.ts {torrent_name} {source_dir}
// EXAMPLE: bun run index.ts "SAKAMOTO.DAYS.S01.[DB]" "D:/TORRENT/TEMP/SAKAMOTO DAYS S01 [DB]"
// MY USAGE: run via Qbittorrent when torrent finishes: wsl.exe /home/roberts/.bun/bin/bun run /home/roberts/transcoder-win/index.ts "%N" "'%F'"

// 1. acquire lock
// 2. check if within sleep hours
// 3. Copy torrent files to temp directory
// 4. Extract Subtitles from .mkv files
// 5. Transcode Video files into .mp4
// 5.1 check if within sleep hours for each video
// 5.2 check if video is .mp4 already, then use different preset
// 5.3 check if all video files have been transcoded
// 6. Remove unnecessary files (keep everything except .mp4, .sup, .srt, .ass, .ssa, .vtt, .sub)
// 7. Move files into destination directory
// 8. Remove temp directory
// 9. Release lock

const cleanup = async (exitCode = 0) => {
  log(`Cleaning up before exit with code ${exitCode}`, "WARN");
  await releaseLock();
  log("Cleanup complete");
  await Bun.sleep(1000);
  exit(exitCode);
};

process.on("uncaughtException", async (error) => {
  log(`Uncaught exception: ${error}`, "ERROR");
  await cleanup(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  log(`Unhandled rejection at: ${promise}, reason: ${reason}`, "ERROR");
  await cleanup(1);
});

process.on("SIGINT", async () => {
  await cleanup();
});

process.on("SIGTERM", async () => {
  await cleanup();
});

type fileType = "file" | "directory";

async function main() {
  try {
    await acquireLock();
    await waitSleepHours();

    const now = performance.now();

    const getArgs = () => {
      const args = Bun.argv;

      if (args.length < 4) {
        log("Arguments missing", "ERROR");
        cleanup(0);
      }

      return {
        TORRENT_NAME: args[2]!,
        SOURCE_DIR: args[3]!,
      };
    };

    const { TORRENT_NAME, SOURCE_DIR } = getArgs();
    log(
      `\n[INPUT] torrent name: ${TORRENT_NAME} \n[INPUT] source dir: ${SOURCE_DIR}`
    );

    const wslPath = winToWsl(SOURCE_DIR);
    const jsonPath = resolve(
      METADATA_DIR,
      `${sanitizeFilename(TORRENT_NAME)}.json`
    );

    log(`wslPath: ${wslPath}`, "VERBOSE");
    log(`jsonPath: ${jsonPath}`, "VERBOSE");

    // check if .json exists
    const json = Bun.file(jsonPath);
    if (!(await json.exists())) {
      log(`Metadata file for ${TORRENT_NAME} not found`, "ERROR");
      cleanup(1);
    } else {
      log(`Metadata file for ${TORRENT_NAME} found`);
    }
    const jsonData: JSONMetadata = JSON.parse(await json.text());

    // find out it SOURCE_DIR is a directory or file
    const source = Bun.file(wslPath);
    const fileExists = await source.exists();
    let sourceType: fileType = "file";

    if (!fileExists) {
      // if fails to read dir, then doesent exist
      await readdir(wslPath);
      sourceType = "directory";
    }

    log("Metadata and source found");

    let tempTorrentDir = clearTags(join(TEMP_DIR, TORRENT_NAME));

    if (sourceType == "file") {
      const torrentBasename = basename(TORRENT_NAME, extname(TORRENT_NAME));
      tempTorrentDir = clearTags(join(TEMP_DIR, torrentBasename));
    }

    log(
      `\n TEMP_DIR: ${TEMP_DIR} \n JSONPATH: ${jsonPath} \n SOURCE_DIR: ${wslPath} \n TEMPTORRENTDIR: ${tempTorrentDir} \n SOURCETYPE: ${sourceType}`,
      "VERBOSE"
    );

    if (DEVELOPMENT) {
      // check if temp dir exists, if yes, then dont copy files
      try {
        await readdir(tempTorrentDir);
        log(`Temp dir exists, skipping copy`);
      } catch (error) {
        await mkdir(tempTorrentDir, { recursive: true });

        log(`Copying ${wslPath} to ${tempTorrentDir}`);
        if (sourceType === "file") {
          await $`cp "${wslPath}" "${tempTorrentDir}"`;
        } else {
          await $`cp -a "${wslPath}/." "${tempTorrentDir}"`;
        }
      }
    } else {
      await mkdir(tempTorrentDir, { recursive: true });

      log(`Copying ${wslPath} to ${tempTorrentDir}`);
      if (sourceType === "file") {
        await $`cp "${wslPath}" "${tempTorrentDir}"`;
      } else {
        await $`cp -a "${wslPath}/." "${tempTorrentDir}"`;
      }
    }

    const originalSize = await getDirectorySize(tempTorrentDir);

    await exportSubtitles(tempTorrentDir);
    Bun.sleep(2000);
    await transcodeVideos(tempTorrentDir, jsonData.category);
    Bun.sleep(2000);
    await transferFiles(tempTorrentDir, jsonData);

    const newSize = await getDirectorySize(tempTorrentDir);

    // remove temp directory and .json file
    log(`Removing ${tempTorrentDir} and ${jsonPath}`);
    await $`rm -rf "${tempTorrentDir}"`;
    await $`rm "${jsonPath}"`;

    log(`SCRIPT FINISHED! Completed in ${getPerformance(now)}`);

    // Calculate and log size difference
    const sizeDifference = originalSize - newSize;
    const percentChange = ((sizeDifference / originalSize) * 100).toFixed(2);

    if (sizeDifference > 0) {
      log(
        `Size stats: \n Original: ${formatBytes(
          originalSize
        )} \n New: ${formatBytes(newSize)} \n Size Difference: ${formatBytes(
          sizeDifference
        )} \n Percent Change: ${percentChange}% smaller \n`
      );
    } else {
      log(
        `Size stats: \n Original: ${formatBytes(
          originalSize
        )} \n New: ${formatBytes(newSize)} \n Size Difference: ${formatBytes(
          Math.abs(sizeDifference)
        )} \n Percent Change: ${Math.abs(Number(percentChange))}% larger \n`
      );
    }

    await releaseLock();
  } catch (error) {
    log(`Error in main process: ${error}`, "ERROR");
    await cleanup();
    exit(1);
  }
}

main();
