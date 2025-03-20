import { $ } from "bun";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exit } from "node:process";
import { METADATA_DIR } from "./consts";
import {
  acquireLock,
  log,
  releaseLock,
  waitSleepHours,
  type JSONMetadata,
} from "./utils";
import { exportSubtitles } from "./export-subs";
import { transcodeVideos } from "./transcode-videos";
import { transferFiles } from "./transfer-files";
// USAGE: bun run index.ts {torrent_name} {source_dir}
// EXAMPLE: bun run index.ts "SAKAMOTO.DAYS.S01.[DB]" "D:/TORRENT/TEMP/SAKAMOTO DAYS S01 [DB]"

// 1. acquire lock
// 2. check if within sleep hours
// 3. Copy torrent files to temp directory
// 4. Extract Subtitles from .mkv files (RUS, ENG, JAP, LV ONLY)
// 5. Transcode Video files into .mp4
// 5.1 check if within sleep hours for each video
// 5.2 check if video is .mp4 already, then use different preset
// 5.3 check if all video files have been transcoded
// 6. Remove unnecessary files (keep everything except .mp4, .sup, .srt, .ass, .ssa, .vtt, .sub)
// 7. Move files into destination directory
// 7.1 if new addition, ask LLM for series name and use as destination directory
// 8. Remove temp directory
// 9. Release lock

const cleanup = async (exitCode = 0) => {
  log(`Cleaning up before exit with code ${exitCode}`, "WARN");
  await releaseLock();
  log("Cleanup complete", "LOG");
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

    const getArgs = () => {
      const args = Bun.argv;

      if (args.length < 4) {
        log("Arguments missing", "ERROR");
        cleanup(0);
      }

      return { TORRENT_NAME: args[2]!, SOURCE_DIR: args[3]! };
    };
    const { TORRENT_NAME, SOURCE_DIR } = getArgs();

    // check if .json exists
    const jsonPath = join(METADATA_DIR, `${TORRENT_NAME}.json`);
    const json = Bun.file(jsonPath);
    if (!(await json.exists())) {
      log(`Metadata file for ${TORRENT_NAME} not found`, "ERROR");
      cleanup(1);
    }
    const jsonData: JSONMetadata = JSON.parse(await json.text());

    // find out it SOURCE_DIR is a directory or file
    const fileExists = await Bun.file(SOURCE_DIR).exists();
    let sourceType: fileType = "file";

    if (!fileExists) {
      // if fails to read dir, then doesent exist
      await readdir(SOURCE_DIR, { recursive: true });
      sourceType = "directory";
    }

    log("Metadata and source found", "LOG");

    const fullPath = join(process.cwd(), "temp_media");
    const tempTorrentDir = join(fullPath, TORRENT_NAME);
    log(
      `\n FULLPATH: ${fullPath} \n JSONPATH: ${jsonPath} \n SOURCE_DIR: ${SOURCE_DIR} \n TEMPTORRENTDIR: ${tempTorrentDir} \n SOURCETYPE: ${sourceType} \n CWD: ${process.cwd()}`,
      "VERBOSE",
    );

    await mkdir(tempTorrentDir, { recursive: true });

    log(`Moving ${SOURCE_DIR} to ${tempTorrentDir}`, "LOG");
    if (sourceType === "file") {
      await $`cp "${SOURCE_DIR}" "${tempTorrentDir}"`;
    } else {
      await $`cp -R "${SOURCE_DIR}/" "${tempTorrentDir}"`;
    }

    await exportSubtitles(tempTorrentDir);
    await transcodeVideos(tempTorrentDir, jsonData.category);
    await transferFiles(tempTorrentDir, jsonData);

    await releaseLock();
  } catch (error) {
    log(`Error in main process: ${error}`, "ERROR");
    await cleanup();
    exit(1);
  }
}

main();
