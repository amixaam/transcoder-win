import { readdir, rename, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  ALLOW_TRANSCODE,
  DEFAULT_Q,
  KEEP_FILES_WITH_EXTENSION,
  SKIP_TRANSCODE_CODECS,
} from "./consts";
import { getPerformance, log, waitSleepHours } from "./utils";
import { GenericFile, MediaFile } from "./utils/media-file";
import { tryCatch } from "./utils/try-catch";
import { Handbrake } from "./utils/handbrake";
import { findBestQuality } from "./sample-videos";

// Process files after transcoding (cleanup unwanted files)
async function fileCleanup(absoluteDestinationDir: string): Promise<void> {
  const files = await readdir(absoluteDestinationDir, { recursive: true });
  for await (const filePath of files) {
    const file = await GenericFile.init(
      resolve(absoluteDestinationDir, filePath),
    );
    if (file.fileType === "directory") continue;

    if (!KEEP_FILES_WITH_EXTENSION.includes(file.extension)) {
      await unlink(file.unixPath);
      log(`Deleted: ${file.name}`);
    }
  }
}

// Main function
export const transcodeVideos = async (
  absoluteDestinationDir: string,
  mediaCategory: string
) => {
  const files = await readdir(absoluteDestinationDir, { recursive: true });
  let currentDirectory = "";
  let q = DEFAULT_Q;

  log(`absoluteDestinationDir: ${absoluteDestinationDir}`, "VERBOSE");
  log(`files: ${files.length}`, "VERBOSE");

  log("Starting video transcoding process...", "VERBOSE");

  let fileCount = 0;
  for await (const file of files) {
    await waitSleepHours();

    // Skip files that don't need transcoding
    const fileExt = extname(file);
    if (!ALLOW_TRANSCODE.includes(fileExt)) {
      log(`Skipping ${file}: not a transcodeable file`);
      continue;
    }

    const video = await MediaFile.init(resolve(absoluteDestinationDir, file));
    const metadata = await video.getDetails();
    if (!metadata) {
      log(`Skipping ${file}: failed to get metadata`);
      continue;
    }

    // Skip codec or already processed files
    const lowerCodec = metadata.codec.toLowerCase();
    if (
      SKIP_TRANSCODE_CODECS.includes(lowerCodec) ||
      video.base.endsWith("_HBPROCESSED")
    ) {
      const reason = SKIP_TRANSCODE_CODECS.includes(lowerCodec)
        ? `${metadata.codec} codec`
        : "Already processed";

      log(`Skipping ${video.name}: ${reason}`);
      continue;
    }

    fileCount++;

    // Get optimal quality for new directories
    if (currentDirectory !== video.dirPath) {
      currentDirectory = video.dirPath;
      log(`Analyzing new directory: ${currentDirectory}`, "VERBOSE");
      q = await findBestQuality(video, mediaCategory);
    }

    // Transcode the file
    const handbrake = await Handbrake.init(video);
    const { data: _, error: transcodeError } = await tryCatch(
      handbrake.transcode(q),
    );

    if (transcodeError) {
      log(`Transcoding failed unexpectedly: ${transcodeError}`, "ERROR");
    }

    log("-----------------------");
  }

  // Clean up and rename files
  await fileCleanup(absoluteDestinationDir);

  log(`Done transcoding!`);
};
