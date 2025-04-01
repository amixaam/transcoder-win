import { $ } from "bun";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { exit } from "node:process";
import {
  DEFAULT_JSON,
  DEVELOPMENT,
  METADATA_DIR,
  SOURCE_DIR,
  TEMP_DIR,
} from "./consts";
import { exportSubtitles } from "./export-subs";
import { transcodeVideos } from "./transcode-videos";
import { transferFiles } from "./transfer-files";
import {
  acquireLock,
  clearTags,
  getPerformance,
  log,
  readJsonFile,
  releaseLock,
  waitSleepHours,
  type JSONMetadata,
} from "./utils";
import { GenericFile } from "./utils/media-file";
import { tryCatch } from "./utils/try-catch";
import { sendCompletionNotification } from "./discord-notify";

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
//

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
    await acquireLock();
    await waitSleepHours();

    const now = performance.now();

    const verifyArgs = () => {
      const args = Bun.argv;

      if (args.length < 3) {
        log("Arguments missing", "ERROR");
        cleanup(0);
      }
    };

    verifyArgs();

    const TORRENT_NAME = Bun.argv[2]!;

    log(
      `\n[INPUT] torrent name: ${TORRENT_NAME} \n[INPUT] source dir: ${SOURCE_DIR}`,
      "VERBOSE",
    );

    // check if source exists
    const source = await GenericFile.init(SOURCE_DIR);
    if (!source.exists) {
      return log(`Source directory does not exist`, "ERROR");
    }

    // check if json exists and read it
    const jsonPath = resolve(METADATA_DIR, `${TORRENT_NAME}.json`);

    let metadata: JSONMetadata = DEFAULT_JSON;
    const { data: jsonData, error: jsonError } = await tryCatch<JSONMetadata>(
      readJsonFile(jsonPath),
    );
    if (jsonError) {
      log(
        `Metadata file for ${TORRENT_NAME} not found: ${jsonError}. using default values: category = "anime", torrent_type = "new"`,
        "WARN",
      );
    } else {
      metadata = jsonData;
    }

    let tempDir = await GenericFile.init(
      clearTags(join(TEMP_DIR, TORRENT_NAME)),
    );

    if (source.fileType === "file") {
      const torrentBasename = basename(TORRENT_NAME, extname(TORRENT_NAME));
      tempDir = await GenericFile.init(
        clearTags(join(TEMP_DIR, torrentBasename)),
      );
    }

    log(
      `\n JSONPATH: ${jsonPath} \n SOURCE_DIR: ${source.unixPath} \n TEMPTORRENTDIR: ${tempDir.unixPath}`,
      "VERBOSE",
    );

    // copy source files to temp directory
    const copyToTempDir = async () => {
      await mkdir(tempDir.unixPath, { recursive: true });

      log(`Copying ${source.unixPath} to ${tempDir.unixPath}`);
      if (source.fileType === "file") {
        await $`cp "${source.unixPath}" "${tempDir.unixPath}"`;
      } else {
        await $`cp -a "${source.unixPath}/." "${tempDir.unixPath}"`;
      }
    };

    const { data: _, error: tempError } = await tryCatch(
      stat(tempDir.unixPath),
    );
    if (tempError || !DEVELOPMENT) {
      await copyToTempDir();
    }

    const originalMetadata = await tempDir.getDetails();

    // await exportSubtitles(tempDir.unixPath);
    // Bun.sleep(2000);
    await transcodeVideos(tempDir.unixPath, metadata.category);
    Bun.sleep(2000);
    await transferFiles(tempDir.unixPath, metadata);

    const newMetadata = await tempDir.getDetails();

    // remove temp directory and .json file
    log(`Removing ${tempDir.unixPath} and ${jsonPath}`);
    await $`rm -rf "${tempDir.unixPath}"`;
    try {
      await $`rm "${jsonPath}"`;
    } catch (error) {
      log(`Error removing json file: ${error}`, "ERROR");
    }

    log(`SCRIPT FINISHED! Completed in ${getPerformance(now)}`);

    if (!originalMetadata || !newMetadata) {
      await releaseLock();
      return;
    }

    log(`size before: ${originalMetadata.size} MB`);
    log(`size after: ${newMetadata.size} MB`);
    log(`size difference: ${originalMetadata.size - newMetadata.size} MB`);
    log("-------------------------------------");

    await sendCompletionNotification(
      `Transcoded ${TORRENT_NAME} in ${getPerformance(now)}:\n\nSize before: ${originalMetadata.size} MB\nSize after: ${newMetadata.size} MB\nSize difference: ${originalMetadata.size - newMetadata.size} MB\n`,
    );

    await releaseLock();
  } catch (error) {
    log(`Error in main process: ${error}`, "ERROR");
    await cleanup();
    exit(1);
  }
}

main();
