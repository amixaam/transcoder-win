import { sleep } from "bun";
import { BITRATE_RANGES, DEFAULT_Q, SAMPLE_LENGTH, SAMPLES } from "./consts";
import { Handbrake } from "./utils/handbrake";
import { MediaFile } from "./utils/media-file";
import { tryCatch } from "./utils/try-catch";
import { log } from "./utils";

const getBitrateRange = (category: string) => {
  if (category.includes("anime")) return BITRATE_RANGES.Anime;
  else if (category.includes("shows")) return BITRATE_RANGES.Shows;
  else return BITRATE_RANGES.Movies;
};

// using binary search, finds the best quality value for a video
export const findBestQuality = async (
  video: MediaFile,
  category: string
): Promise<number> => {
  // binary search
  //
  // constraints:
  // sample must be LOWER than 95% of the source size AND bitrate
  // sample must be LOWER than the max allowed bitrate
  // sample should be higher than the min allowed bitrate

  const metadata = await video.getDetails();
  if (!metadata) return DEFAULT_Q;

  const bitrateRange = getBitrateRange(category);
  if (!bitrateRange[0] || !bitrateRange[1]) return DEFAULT_Q;

  let attempts = 0;

  let low = 7;
  let high = 40;
  let mid = Math.round(((low + high) / 2) * 10) / 10;
  let best = DEFAULT_Q;
  let bestBitrate = 0;

  const handbrake = await Handbrake.init(video);

  log(
    `Source size: ${metadata.size} MB, Bitrate: ${metadata.bitrate} Mb/s`,
    "VERBOSE"
  );

  while (low < high && attempts < 6 && Math.abs(high - low) >= 0.3) {
    attempts++;

    log("next sample -------------->");
    log(
      `attempt: #${attempts}, low: ${low}, high: ${high}, mid: ${mid}, best: ${best}, bestBitrate: ${bestBitrate}`,
      "VERBOSE"
    );

    const { data, error } = await tryCatch(
      handbrake.sample({
        quality: mid,
        samples: SAMPLES,
        sampleLength: SAMPLE_LENGTH,
      })
    );

    if (error) {
      sleep(2000);
      log(`Error while sampling: ${error}`, "ERROR");
      continue;
    }

    const { estimatedSize, avgBitrate } = data;

    if (estimatedSize > metadata.size * 0.95) {
      low = mid + 1;
      log(
        `Sample size too high, ${estimatedSize} > ${metadata.size * 0.95}`,
        "WARN"
      );
    } else if (avgBitrate > metadata.bitrate * 0.95) {
      low = mid + 1;
      log(
        `Sample bitrate too high, ${avgBitrate} > ${metadata.bitrate * 0.95}`,
        "WARN"
      );
    } else if (avgBitrate > bitrateRange[1]) {
      low = mid + 1;
      log(
        `Sample bitrate too high, ${avgBitrate} > ${bitrateRange[1]}`,
        "WARN"
      );
    } else if (avgBitrate < bitrateRange[0]) {
      high = mid - 1;
      if (avgBitrate > bestBitrate) {
        bestBitrate = avgBitrate;
        best = mid;
        log(
          `New best bitrate: ${bestBitrate} Mb/s, New best quality: ${best}`,
          "VERBOSE"
        );
      } else {
        log(
          `Sample bitrate too low, ${avgBitrate} < ${bitrateRange[0]}`,
          "WARN"
        );
      }
    } else {
      if (avgBitrate > bestBitrate) {
        bestBitrate = avgBitrate;
        best = mid;

        log(
          `New best bitrate: ${bestBitrate} Mb/s, New best quality: ${best}`,
          "VERBOSE"
        );
      } else {
        log(
          `Sample within range, ${avgBitrate} Mb/s, but not best yet (best: ${bestBitrate} Mb/s)`
        );
      }

      high = mid - 1;
    }

    mid = Math.round(((low + high) / 2) * 10) / 10;
  }

  return best;
};
