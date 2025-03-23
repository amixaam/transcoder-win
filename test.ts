import { GenericFile, MediaFile } from "./utils/media-file";

const path =
  "/Users/robertsbrinkis/Downloads/Spider-Man Across the Spider-Verse 2023 HYBRID BluRay 1080p DTS-HD MA TrueHD 7.1 Atmos x264-MgB.mp4";
const dirPath =
  "D:\\TORRENT\\MEDIA\\[Anime Time] Kaguya Sama - Love Is War (S01+S02+S03+OVA+PV) [BD][Dual Audio][1080p][HEVC 10bit x265][AAC][Eng Sub] [Batch] Kaguya-sama wa Kokurasetai Tensai-tachi no Renai Zunousen";
const wfilePath =
  "D:\\TORRENT\\MEDIA\\[Anime Time] Kaguya Sama - Love Is War (S01+S02+S03+OVA+PV) [BD][Dual Audio][1080p][HEVC 10bit x265][AAC][Eng Sub] [Batch] Kaguya-sama wa Kokurasetai Tensai-tachi no Renai Zunousen\\[Anime Time] Kaguya Sama - Love Is War\\[Anime Time] Kaguya Sama - Love Is War - 01.mkv";
// const file = await Bun.file(
//   "/Users/robertsbrinkis/Downloads/nonexistant.json",
// ).text();
// console.log(file);

const filePath = dirPath;
const dir = new GenericFile(filePath);
console.log(await dir.getDetails());

const file = new MediaFile(wfilePath);
console.log(await file.getDetails());
