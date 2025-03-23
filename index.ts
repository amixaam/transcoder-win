import { $ } from "bun";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { exit } from "node:process";
import { DEVELOPMENT, METADATA_DIR, TEMP_DIR } from "./consts";
import { exportSubtitles } from "./export-subs";
import { transcodeVideos } from "./transcode-videos";
import { transferFiles } from "./transfer-files";
import {
  acquireLock,
  clearTags,
  formatMegaBytes,
  getPerformance,
  log,
  readJsonFile,
  releaseLock,
  sanitizeFilename,
  waitSleepHours,
  type JSONMetadata,
} from "./utils";
import { GenericFile } from "./utils/media-file";
import { tryCatch } from "./utils/try-catch";

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

async function main() {
  try {
    log(`Starting transcoder-win: ${Bun.argv[2]!}`);
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
      `\n[INPUT] torrent name: ${TORRENT_NAME} \n[INPUT] source dir: ${SOURCE_DIR}`,
      "VERBOSE"
    );

    // check if source exists
    const source = new GenericFile(SOURCE_DIR);
    if (!(await source.exists())) {
      return log(`Source directory does not exist`, "ERROR");
    }

    // check if json exists and read it
    const jsonPath = resolve(
      METADATA_DIR,
      `${sanitizeFilename(TORRENT_NAME)}.json`
    );

    const { data: metadata, error: jsonError } = await tryCatch<JSONMetadata>(
      readJsonFile(jsonPath)
    );
    if (jsonError) {
      return log(
        `Metadata file for ${TORRENT_NAME} not found: ${jsonError}`,
        "ERROR"
      );
    }

    let cleanTorrentName = sanitizeFilename(TORRENT_NAME);
    cleanTorrentName = clearTags(cleanTorrentName);

    let tempDir = new GenericFile(join(TEMP_DIR, cleanTorrentName));

    if ((await source.fileType()) === "file") {
      const torrentBasename = basename(TORRENT_NAME, extname(TORRENT_NAME));
      const cleanBasename = sanitizeFilename(clearTags(torrentBasename));
      tempDir = new GenericFile(join(TEMP_DIR, cleanBasename));
    }

    log(
      `\n JSONPATH: ${jsonPath} \n SOURCE_DIR: ${source.unixPath} \n TEMPTORRENTDIR: ${tempDir.unixPath}`,
      "VERBOSE"
    );

    // copy source files to temp directory
    const copyToTempDir = async () => {
      await mkdir(tempDir.unixPath, { recursive: true });

      log(`Copying ${source.unixPath} to ${tempDir.unixPath}`);
      if ((await source.fileType()) === "file") {
        await $`cp "${source.unixPath}" "${tempDir.unixPath}"`;
      } else {
        await $`cp -a "${source.unixPath}/." "${tempDir.unixPath}"`;
      }
    };

    const { data: _, error: tempError } = await tryCatch(
      stat(tempDir.unixPath)
    );
    if (tempError || !DEVELOPMENT) {
      log(`Creating temp directory: ${tempDir.unixPath}`);

      const { data: _, error: copyError } = await tryCatch(copyToTempDir());
      if (copyError) {
        log(`Error copying files: ${copyError}`, "ERROR");
        throw copyError;
      }
    }

    Bun.sleep(1000);
    const originalMetadata = await tempDir.getDetails();

    await exportSubtitles(tempDir.unixPath);
    Bun.sleep(2000);
    await transcodeVideos(tempDir.unixPath, metadata.category);
    Bun.sleep(2000);
    // await transferFiles(tempDir.unixPath, metadata);

    const newMetadata = await tempDir.getDetails();

    // remove temp directory and .json file
    log(`Removing ${tempDir.unixPath} and ${jsonPath}`);
    // try {
    //   await $`rm -rf "${tempDir.unixPath}"`;

    //   const jsonFile = Bun.file(jsonPath);
    //   if (await jsonFile.exists()) {
    //     await $`rm "${jsonPath}"`;
    //   } else {
    //     log(`JSON file ${jsonPath} not found for removal`, "WARN");
    //   }
    // } catch (error) {
    //   log(`Error removing directory or JSON file: ${error}`, "ERROR");
    // }

    log(`SCRIPT FINISHED! Completed in ${getPerformance(now)}`);

    // Calculate and log size Difference
    if (!originalMetadata || !newMetadata) return;
    const sizeDifference = originalMetadata.size - newMetadata.size;
    const percentChange = (
      (sizeDifference / originalMetadata.size) *
      100
    ).toFixed(2);

    if (sizeDifference > 0) {
      log(
        `Size stats: \nOriginal: ${formatMegaBytes(
          originalMetadata.size
        )} \nNew: ${formatMegaBytes(
          newMetadata.size
        )} \nSize Difference: ${formatMegaBytes(
          sizeDifference
        )} \nPercent Change: ${percentChange}% smaller \n`
      );
    } else {
      log(
        `Size stats: \n Original: ${formatMegaBytes(
          originalMetadata.size
        )} \n New: ${formatMegaBytes(
          newMetadata.size
        )} \n Size Difference: ${formatMegaBytes(
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
