import { dirname, resolve } from "node:path";

// works with sources being sent as a windows path
// if any path below is the opposite path (windows vs WSL), then it will probably error.

export const BASE_DIR = resolve(dirname(Bun.argv[1]!));
export const PRESET_DIR = resolve(BASE_DIR, "presets/");
export const LOG_FILE = resolve(BASE_DIR, "transcoder-win.log");
export const LOCK_FILE = resolve(BASE_DIR, "lockfile.lock");

// metadata is something that is bundled with a different project of mine
// json file with the attributes: media_output_directory, json_output_directory, torrent_type, category, hash, name, size
// only uses media_output_directory, torrent_type (in transfer-files.ts) and category (transcode-videos.ts).
export const METADATA_DIR = "/mnt/d/TORRENT/TEMP";
export const TEMP_DIR = "/mnt/d/TORRENT/TEMP/MEDIA";
export const HANDBRAKE_PATH = "C:\\Users\\Roberts\\HandBrakeCLI.exe";

// Keep subtitles with these language codes, delete rest
// keep empty array to keep all subtitles
export const KEEP_LANGUAGE_CODES = [
  "en",
  "eng",
  "eng",
  "ja",
  "jpn",
  "jpn",
  "ru",
  "rus",
  "rus",
  "lv",
  "lav",
  "lav",
  "zxx", // signs & songs
  "und", // undefined
];

// subtitle presets should be within ./presets/
export const SUBTITLE_PRESET = "subs.json"; // ./presets/subs.json
export const NO_SUBTITLE_PRESET = "no-subs.json"; // ./presets/no-subs.json

// what these presets are named. You can check this in the preset .json file's "PresetName" property
export const SUBTITLE_PRESET_NAME = "AMD SUBS";
export const NO_SUBTITLE_PRESET_NAME = "AMD NO-SUBS";

// default quality value if trying to get the best one automatically fails
export const DEFAULT_Q = 25;

// when trying for best quality, encode videos for this many seconds. automatically shortens if source is shorter.
export const TEST_ENCODE_FOR_SECONDS = 90;

// processes all media to .mp4
export const SKIP_TRANSCODE_CODECS = ["av1"]; // skips transcoding for these codecs
export const ALLOW_TRANSCODE = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".flv",
  ".webm",
];
export const EIGHT_BIT_COLOR_PROFILES = ["yuv420p", "yuv444p"]; // uses x265, any other color profile encoded with 10bit color

export const HARDWARE_ACCEL_TYPE: string = "vcn"; // leave empty to disable. vcn - AMD
export const hwAccel_h265_10 = "vce_h265_10bit";
export const hwAccel_h265 = "vce_h265";
export const software_h265 = "x265";
export const software_h265_10 = "x265_10bit";

// Bitrate ranges in Mb/s
// will try to no exceed the max.
// allows bitrate to be below the min if source is below the min aswell.
// change the ranges to fit your needs / network speed
export const BITRATE_RANGES = {
  Anime: [1, 2.5],
  Shows: [2, 4],
  Movies: [3, 6],
};

// After transcoding, only keep these extensions, delete rest
export const KEEP_FILES_WITH_EXTENSION = [
  ".mp4",
  ".ass",
  ".srt",
  ".usf",
  ".vtt",
  ".sub",
  ".sup",
  ".textst",
  ".dvb",
];

// extra logs
export const VERBOSE = true;

// skips sleep timer; skips copying to temp directory when necessary; for development
export const DEVELOPMENT = false;

export const SKIP_SLEEP = true; // or just skip the sleep timer, will run during the night
export const SLEEP_FROM_H = 23; // from when to sleep hours (23:00 / 11PM)
export const SLEEP_TO_H = 7; // to when to sleep hours (7:00 / 7AM)
export const SLEEP_TO_M = 30; // to when to sleep minutes (SLEEP_TO_H:30 AM)

// transfer files to this IP address
const TRANSFER_TO_USER = "roberts";
const TRANSFER_TO_IP = "192.168.1.110";
export const TRANSFER_TO = `${TRANSFER_TO_USER}@${TRANSFER_TO_IP}`;
export const DEFAULT_TRANSFER_DIR = "/media/roberts/jellyfin/media/UNSORTED";
