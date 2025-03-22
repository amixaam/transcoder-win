import { GenericFile, MediaFile } from "./utils/media-file";

const path =
  "/Users/robertsbrinkis/Downloads/Spider-Man Across the Spider-Verse 2023 HYBRID BluRay 1080p DTS-HD MA TrueHD 7.1 Atmos x264-MgB.mp4";
const dirPath = "/Users/robertsbrinkis/Downloads";

const file = await Bun.file(
  "/Users/robertsbrinkis/Downloads/nonexistant.json",
).text();
console.log(file);

// const file = new MediaFile(path);
//
// console.log(await file.getDetails());
