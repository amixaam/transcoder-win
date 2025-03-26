import { DEFAULT_Q, SAMPLE_LENGTH, SAMPLES } from "./consts";
import { Handbrake } from "./utils/handbrake";
import { MediaFile } from "./utils/media-file";

const path = "/Users/robertsbrinkis/Downloads/Specials/Konosuba.mp4";

// const video = await MediaFile.init(path);
// const handbrake = await Handbrake.init(video);
// await handbrake.sample({
//   quality: 25,
//   samples: 10,
//   sampleLength: 10,
// });

// console.log(await video.getDetails());

// const res = await handbrake.transcode(25);
// console.log(await res.getDetails());

// input

const video = await MediaFile.init(Bun.argv[3]!);
const handbrake = await Handbrake.init(video);
await handbrake.sample({
  quality: DEFAULT_Q,
  samples: SAMPLES,
  sampleLength: SAMPLE_LENGTH,
});

console.log(await video.getDetails());

const res = await handbrake.transcode(DEFAULT_Q);
console.log(await res.getDetails());
