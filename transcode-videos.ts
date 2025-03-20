import { readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { getVideoMetadata, log, waitSleepHours, type Metadata } from "./utils";
import { $ } from "bun";
import { HwAccelType, NO_SUBTITLE_PRESET, SUBTITLE_PRESET } from "./consts";

const typesToTranscode = ["mp4", "mkv", "avi", "mov", "flv", "webm"];
const keepColorProfiles = ["yuv420p", "yuv444p"];

// in Mb/s
const bitrateRanges = {
  Anime: [1.3, 3],
  Shows: [2, 4],
  Movies: [3, 6],
};

const getBitrateRange = (category: string) => {
  if (category.includes("anime")) return bitrateRanges.Anime;
  else if (category.includes("shows")) return bitrateRanges.Shows;
  else return bitrateRanges.Movies;
};

async function processFiles(absoluteDestinationDir: string): Promise<void> {
  const unsortedFiles = await readdir(absoluteDestinationDir, {
    recursive: true,
  });

  for await (const filePath of unsortedFiles) {
    const absoluteFilePath = join(absoluteDestinationDir, filePath);
    const fileStat = await stat(absoluteFilePath);

    if (fileStat.isDirectory()) {
      continue; // Skip directories
    }

    const fileExtension = extname(filePath).toLowerCase();
    const fileName = basename(filePath);

    const validExtensions = [
      ".mp4",
      ".ass",
      ".srt",
      ".usf",
      ".vtt",
      ".sub",
      ".sup",
      ".textst",
      ".dvb",
    ];

    if (!validExtensions.includes(fileExtension)) {
      await unlink(absoluteFilePath);
      console.log(`Deleted: ${absoluteFilePath} (invalid extension)`);
      continue;
    }

    if (fileExtension === ".mp4" && !fileName.endsWith("_HBPROCESSED.mp4")) {
      await unlink(absoluteFilePath);
      console.log(`Deleted: ${absoluteFilePath} (not _HBPROCESSED.mp4)`);
      continue;
    }
  }

  const unrenamedFiles = await readdir(absoluteDestinationDir, {
    recursive: true,
  });

  for await (const filePath of unrenamedFiles) {
    const absoluteFilePath = join(absoluteDestinationDir, filePath);
    const fileStat = await stat(absoluteFilePath);

    if (fileStat.isDirectory()) {
      continue; // Skip directories
    }

    const fileName = basename(filePath);

    if (fileName.endsWith("_HBPROCESSED.mp4")) {
      const newFileName = fileName.replace("_HBPROCESSED.mp4", ".mp4");
      const newFilePath = join(absoluteDestinationDir, newFileName);
      await rename(absoluteFilePath, newFilePath);
      console.log(`Renamed: ${absoluteFilePath} to ${newFilePath}`);
    }
  }
}

// Transcodes first 30 seconds of video and predicts full size. Adjusts arguments accordingly.
const getHandbrakeArgs = async (metadata: Metadata, mediaCategory: string) => {
  const outputFileName = metadata.fileName.split(".")[0]! + `_HBPROCESSED.mp4`;

  const encodeForSeconds = 30;
  const videoChunkCount = Math.ceil(metadata.length / encodeForSeconds);
  const bitrateRange = getBitrateRange(mediaCategory);

  let estimatedSize = Infinity;
  let estimatedBitrate = 0;

  let encoder = !keepColorProfiles.includes(metadata.colorProfile)
    ? "x265_10bit"
    : "x265";

  // chooses which preset to use
  let preset =
    metadata.extension == ".mkv" ? NO_SUBTITLE_PRESET : SUBTITLE_PRESET;

  const presetFullPath = resolve(process.cwd(), "presets/", preset);
  log(`Using preset: ${preset} (${presetFullPath})`, "LOG");

  let q_min = 3;
  let q_max = 30;

  let low = q_min;
  let high = q_max;
  let mid = Math.round((low + high) / 2);

  let best_q = null;
  let best_bitrate = 0;

  const checkContstraints = () => {
    // 1. Should NOT be above 105% of the source file size
    // 2. Should NOT be above the source bitrate
    // 3. Should be WITHIN the bitrate range

    if (estimatedSize >= metadata.size * 1.05) {
      low = mid + 1;
      log(
        `Is HIGHER than source size (${estimatedSize} > ${metadata.size}). Retrying. Estimated: ${estimatedSize} MB (${estimatedBitrate} Mb/s)`,
      );
    } else if (
      estimatedBitrate >= metadata.bitrate ||
      estimatedBitrate >= bitrateRange[1]!
    ) {
      low = mid + 1;
      log(
        `Is HIGHER than allowed bitrate (${estimatedBitrate} > ${bitrateRange[1]!} or ${metadata.bitrate})Mb/s. Retrying. Estimated: ${estimatedSize} Mb (${estimatedBitrate} Mb/s)`,
      );
    } else if (estimatedBitrate <= bitrateRange[0]!) {
      high = mid - 1;
      if (best_bitrate <= estimatedBitrate) {
        best_q = mid;
        best_bitrate = estimatedBitrate;
        log(
          `Is LOWER than allowed bitrate, but is still New best bitrate: ${best_bitrate} Mb/s (${best_q} q)`,
        );
      } else {
        log(
          `Is LOWER than allowed bitrate (${estimatedBitrate} < ${bitrateRange[0]})Mb/s. Retrying. Estimated: ${estimatedBitrate} Mb/s (${estimatedBitrate} Mb/s)`,
        );
      }
    } else {
      // passes constraints, potential "Sweet spot"
      if (best_bitrate <= estimatedBitrate) {
        best_q = mid;
        best_bitrate = estimatedBitrate;
        high = mid - 1;
        log(`New best bitrate: ${best_bitrate} Mb/s (${best_q} q)`, "LOG");
      } else {
        log(
          `  Constraints MET, but not better than current best (${best_bitrate} Mb/s)`,
          "LOG",
        );
        high = mid - 1; // Still try for lower q
      }
    }

    // calculate new midpoint
    mid = Math.round((low + high) / 2);
  };

  let i = 1;
  while (i < 7 || low <= high) {
    let startAtSeconds = 0;
    log(`ATTEMPT ${i}, Trying for q: ${mid} and preset: ${preset}`, "LOG");

    await $`HandBrakeCLI --preset-import-file "${presetFullPath}" -i "${metadata.filePath}" -o "${metadata.dirPath}/${outputFileName}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${encoder} -q ${mid} --enable-hw-decoding ${HwAccelType}`.quiet();

    const processedMetadata = await getVideoMetadata(
      resolve(dirname(metadata.filePath), outputFileName),
    );

    estimatedSize = processedMetadata!.size * videoChunkCount;
    estimatedBitrate = processedMetadata!.bitrate;

    checkContstraints();
    i += 1;
  }

  if (best_q === null) {
    log(`No successful transcode attempts found. Using default`, "WARN");
  }

  return best_q;
};

export const transcodeVideos = async (
  absoluteDestinationDir: string,
  mediaCategory: string,
) => {
  const files = await readdir(absoluteDestinationDir, { recursive: true });

  let currentDirectory = "";
  let q = null;

  log("in transcodeVideos", "VERBOSE");

  for await (const file of files) {
    if (!typesToTranscode.includes(file.split(".").pop()!)) continue;
    await waitSleepHours();

    const metadata = await getVideoMetadata(
      resolve(absoluteDestinationDir, file),
    );
    if (!metadata) continue;

    // if codec is AV1, skip transcoding
    if (metadata.codec.toLowerCase() === "av1") {
      log(
        `Skipping transcoding of ${metadata.fileName} because it has an AV1 codec`,
        "LOG",
      );
      continue;
    }

    if (metadata.baseName.endsWith("_HBPROCESSED")) {
      log("Skipping transcoding of _HBPROCESSED file", "LOG");
      continue;
    }

    log(`Transcoding ${metadata.fileName}`, "LOG");

    if (currentDirectory != metadata.dirPath) {
      currentDirectory = metadata.dirPath;
      log(`New base dir: ${currentDirectory}`, "VERBOSE");
      log(`Trying for best preset...`, "LOG");
      q = await getHandbrakeArgs(metadata, mediaCategory);
    }

    // transcode video
    const outputFileName =
      metadata.fileName.split(".")[0]! + `_HBPROCESSED.mp4`;

    let encoder = !keepColorProfiles.includes(metadata.colorProfile)
      ? "x265_10bit"
      : "x265";

    let preset =
      metadata.extension == ".mkv" ? NO_SUBTITLE_PRESET : SUBTITLE_PRESET;
    const presetFullPath = resolve(process.cwd(), "presets/", preset);

    // if q is null, use the preset's q value
    if (q === null) {
      await $`HandBrakeCLI --preset-import-file "${presetFullPath}" -i "${metadata.filePath}" -o "${metadata.dirPath}/${outputFileName}" -e ${encoder} --enable-hw-decoding ${HwAccelType}`.quiet();
    } else {
      await $`HandBrakeCLI --preset-import-file -q ${q} "${presetFullPath}" -i "${metadata.filePath}" -o "${metadata.dirPath}/${outputFileName}" -e ${encoder} --enable-hw-decoding ${HwAccelType}`.quiet();
    }
  }

  // remove every video file that isnt processed & potential junk files
  // rename every processed video back to the original name
  await processFiles(absoluteDestinationDir);

  log(`Done transcoding!`, "LOG");
};
