import { DEFAULT_Q, SAMPLE_LENGTH, SAMPLES } from "./consts";
import { sendCompletionNotification } from "./discord-notify";
import { Handbrake } from "./utils/handbrake";
import { GenericFile, MediaFile } from "./utils/media-file";

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
const video = await MediaFile.init(Bun.argv[2]!);
console.log(await video.getDetails());

const handbrake = await Handbrake.init(video);
await handbrake.sample({
  quality: 22,
  samples: SAMPLES,
  sampleLength: SAMPLE_LENGTH,
});

const res = await handbrake.transcode(22);
console.log(await res.getDetails());
