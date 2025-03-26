import { Handbrake } from "./utils/handbrake";
import { GenericFile, MediaFile } from "./utils/media-file";

const path = "/Users/robertsbrinkis/Downloads/Specials/Konosuba.mp4";
const dirPath = "/Users/robertsbrinkis/Downloads";

const video = await MediaFile.init(path);
const handbrake = await Handbrake.init(video);
await handbrake.sample({
  quality: 25,
  samples: 10,
  sampleLength: 10,
});

// await handbrake.transcode(25);
console.log(await video.getDetails());

const res = await handbrake.transcode(25);
console.log(await res.getDetails());
