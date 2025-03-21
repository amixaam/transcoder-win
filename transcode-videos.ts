import { $ } from "bun";
import { readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { join as winJoin } from "node:path/win32";
import {
  ALLOW_TRANSCODE,
  BITRATE_RANGES,
  DEFAULT_Q,
  EIGHT_BIT_COLOR_PROFILES,
  HANDBRAKE_PATH,
  HARDWARE_ACCEL_TYPE,
  KEEP_FILES_WITH_EXTENSION,
  NO_SUBTITLE_PRESET,
  PRESET_DIR,
  SKIP_TRANSCODE_CODECS,
  SUBTITLE_PRESET,
  TEST_ENCODE_FOR_SECONDS,
  hwAccel_h265,
  hwAccel_h265_10,
  software_h265,
  software_h265_10,
} from "./consts";
import {
  getPerformance,
  getVideoMetadata,
  log,
  waitSleepHours,
  wslToWin,
  type Metadata,
} from "./utils";

const presetDirPath = wslToWin(PRESET_DIR);
const subtitlePreset = winJoin(presetDirPath, SUBTITLE_PRESET);
const noSubtitlePreset = winJoin(presetDirPath, NO_SUBTITLE_PRESET);

const getBitrateRange = (category: string) => {
  if (category.includes("anime")) return BITRATE_RANGES.Anime;
  else if (category.includes("shows")) return BITRATE_RANGES.Shows;
  else return BITRATE_RANGES.Movies;
};

// Process files after transcoding (cleanup and rename)
async function processFiles(absoluteDestinationDir: string): Promise<void> {
  // First, delete invalid files
  const files = await readdir(absoluteDestinationDir, { recursive: true });
  for await (const file of files) {
    const absoluteFilePath = resolve(absoluteDestinationDir, file);
    if ((await stat(absoluteFilePath)).isDirectory()) continue;

    const fileExtension = extname(file).toLowerCase();
    const fileName = basename(file);

    // Delete invalid extensions or non-processed MP4 files
    if (
      !KEEP_FILES_WITH_EXTENSION.includes(fileExtension) ||
      (fileExtension === ".mp4" && !fileName.endsWith("_HBPROCESSED.mp4"))
    ) {
      await unlink(absoluteFilePath);
      log(`Deleted: ${absoluteFilePath}`);
    }
  }

  Bun.sleep(5000);

  // Rename processed files
  const processedFiles = await readdir(absoluteDestinationDir, {
    recursive: true,
  });
  for await (const file of processedFiles) {
    const absoluteFilePath = resolve(absoluteDestinationDir, file);
    if ((await stat(absoluteFilePath)).isDirectory()) continue;

    const fileName = basename(file);
    if (fileName.endsWith("_HBPROCESSED.mp4")) {
      const newFileName = fileName.replace("_HBPROCESSED.mp4", ".mp4");
      const newFilePath = join(dirname(absoluteFilePath), newFileName);
      await rename(absoluteFilePath, newFilePath);
      log(`Renamed: ${absoluteFilePath} to ${newFilePath}`);
    }
  }
}

// Find optimal quality setting by transcoding a sample
const findOptimalQuality = async (
  metadata: Metadata,
  mediaCategory: string
) => {
  const outputFileName = `${metadata.baseName}_HBPROCESSED.mp4`;
  const bitrateRange = getBitrateRange(mediaCategory);

  // Sample from middle of video
  const startAtSeconds = Math.round(metadata.length / 2);
  const encodeForSeconds = Math.min(
    TEST_ENCODE_FOR_SECONDS,
    metadata.length - startAtSeconds
  );
  const videoChunkCount = Math.ceil(metadata.length / encodeForSeconds);

  // Set encoder based on color profile
  const hwEncoder = EIGHT_BIT_COLOR_PROFILES.includes(metadata.colorProfile)
    ? hwAccel_h265
    : hwAccel_h265_10;
  const softwareEncoder =
    hwEncoder === hwAccel_h265_10 ? software_h265_10 : software_h265;

  // Choose preset based on file extension
  const preset =
    metadata.extension === ".mkv" ? noSubtitlePreset : subtitlePreset;

  // Binary search for optimal quality
  let low = 3;
  let high = 40;
  let mid = Math.round((low + high) / 2);
  let lastMid = null;
  let best_q = DEFAULT_Q;
  let best_bitrate = 0;

  let attempts = 0;
  while (attempts < 8 && (low <= high || mid !== lastMid)) {
    log(`ATTEMPT ${++attempts}, Trying for q = ${mid}...`);

    const winFilePath = wslToWin(metadata.filePath);
    const winDirPath = wslToWin(metadata.dirPath);
    const outputFilePath = winJoin(winDirPath, outputFileName);

    let encodingSuccess = false;

    // Try hardware acceleration first if enabled
    if (HARDWARE_ACCEL_TYPE) {
      try {
        log(`Attempting with hardware acceleration (${HARDWARE_ACCEL_TYPE})`);
        await $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset}" -i "${winFilePath}" -o "${outputFilePath}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${hwEncoder} -q ${mid} --enable-hw-decoding ${HARDWARE_ACCEL_TYPE}`;
        encodingSuccess = true;
      } catch (error) {
        log(
          `Hardware acceleration failed: ${error}. Retrying without.`,
          "WARN"
        );
        await Bun.sleep(5000);
      }
    }

    // Try regular encoding if hardware acceleration failed or was not enabled
    if (!encodingSuccess) {
      try {
        await $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset}" -i "${winFilePath}" -o "${outputFilePath}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${hwEncoder} -q ${mid}`;
        encodingSuccess = true;
      } catch (error) {
        log(
          `Regular encoding failed: ${error}. Trying software fallback.`,
          "ERROR"
        );
        await Bun.sleep(5000);

        // Last resort: software encoding
        try {
          await $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset}" -i "${winFilePath}" -o "${outputFilePath}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${softwareEncoder} -q ${mid}`;
          log(`Software encoding successful`);
          encodingSuccess = true;
        } catch (secondError) {
          log(
            `All encoding methods failed: ${secondError}. Using default quality.`,
            "ERROR"
          );
          return DEFAULT_Q;
        }
      }
    }

    if (encodingSuccess) {
      await Bun.sleep(1000);

      // Get metadata of sample output
      const processedMetadata = await getVideoMetadata(
        resolve(dirname(metadata.filePath), outputFileName)
      );

      if (!processedMetadata) {
        log("Failed to get metadata of processed file", "ERROR");
        continue;
      }

      // Calculate estimated full size and bitrate
      const estimatedSize = processedMetadata.size * videoChunkCount;
      const estimatedBitrate = processedMetadata.bitrate;

      // Check if result meets constraints
      if (
        estimatedSize >= metadata.size - 25 ||
        estimatedBitrate >= metadata.bitrate ||
        estimatedBitrate >= bitrateRange[1]!
      ) {
        // Too large or high bitrate - increase quality value (lower quality)
        low = mid + 1;
        log(
          `Result exceeded constraints. Estimated: ${
            Math.round(estimatedSize * 100) / 100
          } MB (${Math.round(estimatedBitrate * 100) / 100} Mb/s)`
        );
      } else if (estimatedBitrate <= bitrateRange[0]!) {
        // Too low bitrate - decrease quality value (higher quality)
        high = mid - 1;
        if (best_bitrate <= estimatedBitrate) {
          best_q = mid;
          best_bitrate = estimatedBitrate;
        }
        log(
          `Bitrate lower than allowed range, estimated: ${
            Math.round(estimatedBitrate * 100) / 100
          } Mb/s. Best result: ${Math.round(best_bitrate * 100) / 100} Mb/s.`
        );
      } else {
        // Within constraints - potential sweet spot
        if (best_bitrate <= estimatedBitrate) {
          best_q = mid;
          best_bitrate = estimatedBitrate;
        }
        log(
          `Within constraints, estimated: ${
            Math.round(estimatedBitrate * 100) / 100
          } Mb/s. Best result: ${Math.round(best_bitrate * 100) / 100} Mb/s.`
        );
        high = mid - 1; // Still try for lower q (higher quality)
      }

      // Calculate new midpoint
      lastMid = mid;
      mid = Math.round((low + high) / 2);

      await Bun.sleep(5000);
    }
  }

  return best_q || DEFAULT_Q;
};

// Transcode a single file
const transcodeFile = async (metadata: Metadata, q: number) => {
  const outputFileName = `${metadata.baseName}_HBPROCESSED.mp4`;
  const hwEncoder = EIGHT_BIT_COLOR_PROFILES.includes(metadata.colorProfile)
    ? hwAccel_h265
    : hwAccel_h265_10;
  const softwareEncoder =
    hwEncoder === hwAccel_h265_10 ? software_h265_10 : software_h265;
  const preset =
    metadata.extension === ".mkv" ? noSubtitlePreset : subtitlePreset;

  const winFilePath = wslToWin(metadata.filePath);
  const winDirPath = wslToWin(metadata.dirPath);
  const outputFilePath = winJoin(winDirPath, outputFileName);

  log(`Transcoding ${metadata.fileName}. q = ${q}, encoder = ${hwEncoder}`);

  await Bun.sleep(5000);

  // Try hardware acceleration first if enabled
  if (HARDWARE_ACCEL_TYPE) {
    try {
      log(`Attempting with hardware acceleration (${HARDWARE_ACCEL_TYPE})`);
      await $`cmd.exe /c "${HANDBRAKE_PATH}" -q ${q} --preset-import-file "${preset}" -i "${winFilePath}" -o "${outputFilePath}" -e ${hwEncoder} --enable-hw-decoding ${HARDWARE_ACCEL_TYPE}`;
      return true;
    } catch (error) {
      log(`Hardware acceleration failed: ${error}. Retrying without.`, "WARN");
      await Bun.sleep(5000);
    }
  }

  // Try regular encoding
  try {
    await $`cmd.exe /c "${HANDBRAKE_PATH}" -q ${q} --preset-import-file "${preset}" -i "${winFilePath}" -o "${outputFilePath}" -e ${hwEncoder}`;
    return true;
  } catch (error) {
    log(
      `Regular encoding failed: ${error}. Trying software fallback.`,
      "ERROR"
    );
    await Bun.sleep(5000);

    // Last resort: software encoding
    try {
      await $`cmd.exe /c "${HANDBRAKE_PATH}" -q ${q} --preset-import-file "${preset}" -i "${winFilePath}" -o "${outputFilePath}" -e ${softwareEncoder}`;
      log(`Software encoding successful`);
      return true;
    } catch (secondError) {
      log(
        `All encoding methods failed: ${secondError}. Skipping file.`,
        "ERROR"
      );
      return false;
    }
  }
};

// Main function
export const transcodeVideos = async (
  absoluteDestinationDir: string,
  mediaCategory: string
) => {
  const files = await readdir(absoluteDestinationDir, { recursive: true });
  let currentDirectory = "";
  let q = DEFAULT_Q;

  log("Starting video transcoding process", "VERBOSE");

  let fileCount = 0;
  for await (const file of files) {
    // Skip files that don't need transcoding
    const fileExt = extname(file);
    if (!ALLOW_TRANSCODE.includes(fileExt)) continue;

    await waitSleepHours();

    const metadata = await getVideoMetadata(
      resolve(absoluteDestinationDir, file)
    );
    if (!metadata) continue;

    // Skip codec or already processed files
    if (
      SKIP_TRANSCODE_CODECS.includes(metadata.codec.toLowerCase()) ||
      metadata.baseName.endsWith("_HBPROCESSED")
    ) {
      log(
        `Skipping ${metadata.fileName}: ${
          SKIP_TRANSCODE_CODECS.includes(metadata.codec.toLowerCase())
            ? `${metadata.codec} codec`
            : "Already processed"
        }`
      );
      continue;
    }

    fileCount++;
    const startTime = performance.now();

    // Get optimal quality for new directories
    if (currentDirectory !== metadata.dirPath) {
      currentDirectory = metadata.dirPath;
      log(`Analyzing new directory: ${currentDirectory}`, "VERBOSE");
      q = await findOptimalQuality(metadata, mediaCategory);
    }

    // Transcode the file
    await transcodeFile(metadata, q);

    // Log completion time
    const timeString = getPerformance(startTime);
    log(`File #${fileCount} (${metadata.baseName}) completed in ${timeString}`);
    log("-----------------------");
  }

  // Clean up and rename files
  await processFiles(absoluteDestinationDir);

  log(`Done transcoding!`);
};
