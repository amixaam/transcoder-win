import { $ } from "bun";
import { readdir, rename, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  ALLOW_TRANSCODE,
  BITRATE_RANGES,
  DEFAULT_Q,
  EIGHT_BIT_COLOR_PROFILES,
  HANDBRAKE_PATH,
  HARDWARE_ACCEL_TYPE,
  KEEP_FILES_WITH_EXTENSION,
  NO_SUBTITLE_PRESET,
  NO_SUBTITLE_PRESET_NAME,
  PRESET_DIR,
  SKIP_TRANSCODE_CODECS,
  SUBTITLE_PRESET,
  SUBTITLE_PRESET_NAME,
  TEST_ENCODE_FOR_SECONDS,
  hwAccel_h265,
  hwAccel_h265_10,
  software_h265,
  software_h265_10,
} from "./consts";
import { getPerformance, log, waitSleepHours } from "./utils";
import { GenericFile, MediaFile } from "./utils/media-file";
import { tryCatch } from "./utils/try-catch";

const presetDirPath = new GenericFile(PRESET_DIR);
const subtitlePreset = new GenericFile(
  join(presetDirPath.unixPath, SUBTITLE_PRESET)
);
const noSubtitlePreset = new GenericFile(
  join(presetDirPath.unixPath, NO_SUBTITLE_PRESET)
);

const getBitrateRange = (category: string) => {
  if (category.includes("anime")) return BITRATE_RANGES.Anime;
  else if (category.includes("shows")) return BITRATE_RANGES.Shows;
  else return BITRATE_RANGES.Movies;
};

// Process files after transcoding (cleanup and rename)
async function processFiles(absoluteDestinationDir: string): Promise<void> {
  // 1st - delete invalid files
  const files = await readdir(absoluteDestinationDir, { recursive: true });
  for await (const filePath of files) {
    const file = new GenericFile(resolve(absoluteDestinationDir, filePath));
    if ((await file.fileType()) === "directory") continue;

    if (
      !KEEP_FILES_WITH_EXTENSION.includes(file.extension) ||
      (file.extension === ".mp4" && !file.base.endsWith("_HBPROCESSED"))
    ) {
      await unlink(file.unixPath);
      log(`Deleted: ${file.name}`);
    }
  }

  Bun.sleep(1000);

  // 2nd - Rename processed files
  const processedFiles = await readdir(absoluteDestinationDir, {
    recursive: true,
  });
  for await (const filePath of processedFiles) {
    const file = new GenericFile(resolve(absoluteDestinationDir, filePath));
    if ((await file.fileType()) === "directory") continue;

    if (file.base.endsWith("_HBPROCESSED")) {
      const newFileName = file.name.replace("_HBPROCESSED.mp4", ".mp4");
      const newFileUnixPath = join(file.dirPath, newFileName);
      await rename(file.unixPath, newFileUnixPath);
      log(`Renamed: ${file.unixPath} to ${newFileUnixPath}`);
    }
  }
}

const getVideoTranscodeSettings = async (video: MediaFile) => {
  const metadata = await video.getDetails();
  if (!metadata) return;

  const outputFileName = `${video.base}_HBPROCESSED.mp4`;
  const outputVideo = new MediaFile(join(video.dirPath, outputFileName));

  const hardwareEncoder = EIGHT_BIT_COLOR_PROFILES.includes(
    metadata.colorProfile
  )
    ? hwAccel_h265
    : hwAccel_h265_10;
  const softwareEncoder =
    hardwareEncoder === hwAccel_h265_10 ? software_h265_10 : software_h265;

  let preset, presetName;
  if (video.extension === ".mkv") {
    preset = noSubtitlePreset;
    presetName = NO_SUBTITLE_PRESET_NAME;
  } else {
    preset = subtitlePreset;
    presetName = SUBTITLE_PRESET_NAME;
  }

  const startAtSeconds = Math.round(metadata.length / 2);
  const encodeForSeconds = Math.min(
    TEST_ENCODE_FOR_SECONDS,
    metadata.length - startAtSeconds
  );
  const videoChunkCount = Math.ceil(metadata.length / encodeForSeconds);

  return {
    outputVideo,
    hardwareEncoder,
    softwareEncoder,
    preset,
    presetName,
    testing: {
      startAtSeconds,
      encodeForSeconds,
      videoChunkCount,
    },
  };
};

// Find optimal quality setting by transcoding a sample
const findOptimalQuality = async (video: MediaFile, mediaCategory: string) => {
  const bitrateRange = getBitrateRange(mediaCategory);

  const metadata = await video.getDetails();
  if (!metadata) return DEFAULT_Q;

  const settings = await getVideoTranscodeSettings(video);
  if (!settings) return DEFAULT_Q;

  const {
    outputVideo,
    hardwareEncoder,
    softwareEncoder,
    preset,
    presetName,
    testing,
  } = settings;

  const { startAtSeconds, encodeForSeconds, videoChunkCount } = testing;

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
    let encodingSuccess = false;

    // 1st try - with hardware accel
    if (HARDWARE_ACCEL_TYPE) {
      const { data: _, error } = await tryCatch(
        $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset.winPath}" --preset "${presetName}" -i "${video.winPath}" -o "${outputVideo.winPath}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${hardwareEncoder} -q ${mid} --enable-hw-decoding ${HARDWARE_ACCEL_TYPE}`
      );
      if (error) {
        log(`Hardware acceleration failed: ${error}`, "WARN");
        Bun.sleep(5000);
      } else encodingSuccess = true;
    }

    // 2nd try - with semi-software fallback
    if (!encodingSuccess) {
      log(`Attempting with semi-software fallback`);
      const { data: _, error } = await tryCatch(
        $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset.winPath}" --preset "${presetName}" -i "${video.winPath}" -o "${outputVideo.winPath}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${hardwareEncoder} -q ${mid}`
      );
      if (error) {
        log(`Software fallback failed: ${error}`, "ERROR");
        Bun.sleep(5000);
      } else encodingSuccess = true;
    }

    // 3rd try - with full software fallback
    if (!encodingSuccess) {
      log(`Attempting with full software fallback`);
      const { data: _, error } = await tryCatch(
        $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset.winPath}" --preset "${presetName}" -i "${video.winPath}" -o "${outputVideo.winPath}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -e ${softwareEncoder} -q ${mid}`
      );
      if (error) {
        log(
          `Software fallback failed, using default quality: ${error}`,
          "ERROR"
        );
        Bun.sleep(5000);
        return DEFAULT_Q;
      } else encodingSuccess = true;
    }

    // compare with previous sample - Binary search
    if (encodingSuccess) {
      await Bun.sleep(1000);

      // Get metadata of sample output
      const outputMetadata = await outputVideo.getDetails();
      if (!outputMetadata) {
        log("Failed to get metadata of processed file", "ERROR");
        continue;
      }

      // Calculate estimated full size and bitrate
      const estimatedSize = outputMetadata.size * videoChunkCount;
      const estimatedBitrate = outputMetadata.bitrate;

      // Check if result meets constraints
      if (
        estimatedSize >= metadata.size ||
        estimatedBitrate >= metadata.bitrate ||
        estimatedBitrate >= bitrateRange[1]!
      ) {
        // Too large or high bitrate - increase quality value (lower quality)
        low = mid + 1;
        log(
          `Result exceeded constraints. Estimated: ${estimatedSize} MB > ${metadata.size} MB (Bitrate: ${estimatedBitrate} Mb/s)`
        );
      } else if (estimatedBitrate <= bitrateRange[0]!) {
        // Too low bitrate - decrease quality value (higher quality)
        high = mid - 1;
        if (best_bitrate <= estimatedBitrate) {
          best_q = mid;
          best_bitrate = estimatedBitrate;
        }
        log(
          `Bitrate lower than allowed range, estimated: ${estimatedBitrate} Mb/s < ${bitrateRange[0]} Mb/s. Best result: ${best_bitrate} Mb/s.`
        );
      } else {
        // Within constraints - potential sweet spot
        if (best_bitrate <= estimatedBitrate) {
          best_q = mid;
          best_bitrate = estimatedBitrate;
        }
        log(
          `Within constraints, estimated: ${estimatedBitrate} Mb/s. Best result: ${best_bitrate} Mb/s.`
        );
        high = mid - 1; // Still try for lower q (higher quality)
      }

      // Calculate new midpoint
      lastMid = mid;
      mid = Math.round((low + high) / 2);
    }
  }

  return best_q || DEFAULT_Q;
};

// Transcode a single file
const transcodeFile = async (video: MediaFile, q: number) => {
  const settings = await getVideoTranscodeSettings(video);
  if (!settings) return;

  const { outputVideo, hardwareEncoder, softwareEncoder, preset, presetName } =
    settings;

  log(`Transcoding ${video.name}. q = ${q}, encoder = ${hardwareEncoder}`);

  await Bun.sleep(5000);

  // 1st try - with hardware accel
  if (HARDWARE_ACCEL_TYPE) {
    const { data: _, error: hwError } = await tryCatch(
      $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset.winPath}" --preset "${presetName}" -i "${video.winPath}" -o "${outputVideo.winPath}" -e ${hardwareEncoder} -q ${q} --enable-hw-decoding ${HARDWARE_ACCEL_TYPE}`
    );
    if (hwError) {
      log(`Hardware acceleration failed: ${hwError}`, "WARN");
      Bun.sleep(5000);
    } else return true;
  }

  // 2nd try - with semi-software fallback
  log(`Attempting with semi-software fallback`);
  const { data: __, error: semiError } = await tryCatch(
    $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset.winPath}" --preset "${presetName}" -i "${video.winPath}" -o "${outputVideo.winPath}" -e ${hardwareEncoder} -q ${q}`
  );
  if (semiError) {
    log(`Software fallback failed: ${semiError}`, "ERROR");
    Bun.sleep(5000);
  } else return true;

  // 3rd try - with full software fallback
  log(`Attempting with full software fallback`);
  const { data: ___, error: softError } = await tryCatch(
    $`cmd.exe /c "${HANDBRAKE_PATH}" --preset-import-file "${preset.winPath}" --preset "${presetName}" -i "${video.winPath}" -o "${outputVideo.winPath}" -e ${softwareEncoder} -q ${q}`
  );
  if (softError) {
    log(`Software fallback failed, skipping file: ${softError}`, "ERROR");
    Bun.sleep(5000);
  } else return true;
};

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

    const video = new MediaFile(resolve(absoluteDestinationDir, file));
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
    const startTime = performance.now();

    // Get optimal quality for new directories
    if (currentDirectory !== video.dirPath) {
      currentDirectory = video.dirPath;
      log(`Analyzing new directory: ${currentDirectory}`, "VERBOSE");
      q = await findOptimalQuality(video, mediaCategory);
    }

    // Transcode the file
    const { data: _, error: transcodeError } = await tryCatch(
      transcodeFile(video, q)
    );

    if (transcodeError) {
      log(`Transcoding failed unexpectedly: ${transcodeError}`, "ERROR");
    }

    // Log completion time
    const timeString = getPerformance(startTime);
    log(`File #${fileCount} (${video.base}) completed in ${timeString}`);
    log("-----------------------");
  }

  // Clean up and rename files
  await processFiles(absoluteDestinationDir);

  log(`Done transcoding!`);
};
