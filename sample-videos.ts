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
  category: string,
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

  let attempts = 6;

  let low = 0;
  let high = 31;
  let mid = Math.round(((low + high) / 2) * 10) / 10;
  let best = DEFAULT_Q;
  let bestBitrate = 0;

  while (low < high && attempts > 0) {
    attempts--;

    const handbrake = await Handbrake.init(video);
    const { data, error } = await tryCatch(
      handbrake.sample({
        quality: mid,
        samples: SAMPLES,
        sampleLength: SAMPLE_LENGTH,
      }),
    );

    if (error) {
      sleep(2000);
      log(`Error while sampling: ${error}`, "ERROR");
      continue;
    }

    const { estimatedSize, avgBitrate } = data;

    if (estimatedSize > metadata.size * 0.95) {
      low = mid + 1;
    } else if (avgBitrate > metadata.bitrate * 0.95) {
      low = mid + 1;
    } else if (avgBitrate > bitrateRange[1]) {
      low = mid + 1;
    } else if (avgBitrate < bitrateRange[0]) {
      high = mid - 1;
    } else {
      if (avgBitrate > bestBitrate) {
        bestBitrate = avgBitrate;
        best = mid;
      }

      high = mid - 1;
    }
  }

  return best;
};
