import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getVideoMetadata, log, waitSleepHours, type Metadata } from "./utils";
import { $ } from "bun";

const typesToTranscode = ["mp4", "mkv", "avi", "mov", "flv", "webm"];
const keepColorProfiles = ["yuv420p", "yuv444p"];

// in Mb/s
const bitrateRanges = {
  Anime: [1.3, 3],
  Shows: [2, 4],
  Movies: [3, 5],
};

const getBitrateRange = (category: string) => {
  if (category.includes("anime")) return bitrateRanges.Anime;
  else if (category.includes("shows")) return bitrateRanges.Shows;
  else return bitrateRanges.Movies;
};

const inRange = (value: number, range: number[]) => {
  return value >= range[0]! && value <= range[1]!;
};

// Transcodes first 30 seconds of video and predicts full size. Adjusts arguments accordingly.
const getHandbrakeArgs = async (metadata: Metadata, mediaCategory: string) => {
  const outputFileName = metadata.fileName.split(".")[0]! + `_HBPROCESSED.mp4`;
  const encodeForSeconds = 30;

  let estimatedSize = 100 * 1000;
  let estimatedBitrate = 3001;

  let q = 15;
  let encoder = "x265";

  if (!keepColorProfiles.includes(metadata.colorProfile)) {
    encoder = "x265_10bit";
  }

  const videoChunkCount = Math.ceil(metadata.length / encodeForSeconds);

  while (
    !inRange(estimatedSize, [metadata.size / 2, metadata.size * 1.1]) &&
    !inRange(estimatedBitrate, getBitrateRange(mediaCategory))
  ) {
    let startAtSeconds = 0;
    if (metadata.length > startAtSeconds + encodeForSeconds) {
    }
    log(`Trying for q: ${q} and encoder: ${encoder}`, "LOG");
    await $`HandBrakeCLI -i "${metadata.filePath}" -o "${dirname(metadata.filePath)}/${outputFileName}" --start-at seconds:${startAtSeconds} --stop-at seconds:${encodeForSeconds} -O --align-av -e ${encoder} -q ${q} --enable-hw-decoding toolbox`.quiet();

    const processedMetadata = await getVideoMetadata(
      resolve(dirname(metadata.filePath), outputFileName),
    );

    estimatedSize = processedMetadata!.size * videoChunkCount;
    estimatedBitrate = processedMetadata!.bitrate;
    q += 0.5;

    log(
      `Estimated size: ${estimatedSize} MB and ${processedMetadata!.length} seconds (videochunks: ${videoChunkCount} (${metadata.length} / ${encodeForSeconds})) and estimated bitrate: ${estimatedBitrate} kbps`,
      "LOG",
    );
  }
};

export const transcodeVideos = async (
  absoluteDestinationDir: string,
  mediaCategory: string,
) => {
  const files = await readdir(absoluteDestinationDir, { recursive: true });

  let currentDirectory = "";

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
      await getHandbrakeArgs(metadata, mediaCategory);
    }
  }

  log(`Done transcoding!`, "LOG");
};
