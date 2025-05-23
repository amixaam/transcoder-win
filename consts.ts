import { dirname, resolve } from "node:path";
import type { JSONMetadata } from "./utils";

declare module "bun" {
  interface Env {
    TRANSFER_TO_USER: string;
    TRANSFER_TO_IP: string;
    DISCORD_BOT_TOKEN: string;
    DISCORD_USER_ID: string;
    API_URL: string;
  }
}

// works with sources being sent as a windows path
// if any path below is the opposite path (windows vs WSL), then it will probably error.

// if using windows with WSL, pick mixed, if only unix based systems, pick unix
export const RUN_TYPE: "mixed" | "unix" = "mixed";

export const BASE_DIR = resolve(dirname(Bun.argv[1]!));
export const PRESET_DIR = resolve(BASE_DIR, "presets/");
export const LOG_FILE = resolve(BASE_DIR, "transcoder-win.log");
export const LOCK_FILE = resolve(BASE_DIR, "lockfile.lock");

// metadata is something that is bundled with a different project of mine
// json file with the attributes: media_output_directory, json_output_directory, torrent_type, category, hash, name, size
// only uses media_output_directory, torrent_type (in transfer-files.ts) and category (transcode-videos.ts).

// My Windows settings
export const METADATA_DIR = "/mnt/d/TORRENT/TEMP";
export const TEMP_DIR = "/mnt/d/TORRENT/TEMP/MEDIA";
export const SOURCE_BASE_DIR = "/mnt/d/TORRENT/MEDIA"; // unix style path

export const CALL_HANDBRAKE = [
  `cmd.exe`,
  "/c",
  "C:\\Users\\Roberts\\HandBrakeCLI.exe",
]; // how to call handbrake, might depend on your situation

// My macOS settings
// export const METADATA_DIR = resolve(BASE_DIR, "metadata/");
// export const TEMP_DIR = resolve(BASE_DIR, "temp/");
// export const SOURCE_BASE_DIR = "/Users/robertsbrinkis/Documents/torrents/"; // unix style path
// export const CALL_HANDBRAKE = ["HandBrakeCLI"]; // how to call handbrake, might depend on your situation

export const SOURCE_DIR = resolve(SOURCE_BASE_DIR, Bun.argv[2]!);

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

export const DEFAULT_JSON: JSONMetadata = {
  torrent_type: "new",
  category: "animated",
};

// subtitle presets should be within ./presets/
export const SUBTITLE_PRESET = "subs-mkv.json"; // ./presets/subs.json
export const NO_SUBTITLE_PRESET = "no-subs-mkv.json"; // ./presets/no-subs.json

// default quality value if trying to get the best one automatically fails
export const DEFAULT_Q = 25;

// when trying for best quality, sample n times for m seconds spread evenly across the source. automatically shortens if source is shorter.
export const SAMPLES = 10;
export const SAMPLE_LENGTH = 10;

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
export const EIGHT_BIT_COLOR_PROFILES = ["yuv420p", "yuv444p"]; //these are 8bit color profiles, any other color profile encoded with 10bit color (eg. 12bit -> 10bit)

export const TO_CONTAINER = ".mkv"; // end result will be in this container, MUST include the dot

// My Windows settings
export const HARDWARE_ACCEL_TYPE: string = "vcn"; // leave empty to disable. vcn - AMD, Toolbox - Apple
export const hwAccel_h265_10 = "vce_h265_10bit";
export const hwAccel_h265 = "vce_h265";

// My macOS settings
// export const HARDWARE_ACCEL_TYPE: string = "Toolbox"; // leave empty to disable. vcn - AMD, Toolbox - Apple
// export const hwAccel_h265_10 = "vt_h265_10bit";
// export const hwAccel_h265 = "vt_h265";

export const software_h265 = "x265";
export const software_h265_10 = "x265_10bit";

// Bitrate ranges in Mb/s
// will try to no exceed the max.
// allows bitrate to be below the min if source is below the min aswell.
// change the ranges to fit your needs / network speed
export const BITRATE_RANGES = {
  animated: [1, 3.5],
  shows: [2, 4.25],
  movies: [2, 6],
};

// After transcoding, only keep these extensions, delete rest
export const KEEP_FILES_WITH_EXTENSION = [
  ".mkv",
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
export const SKIP_SLEEP = false;

export const DEVELOPMENT = false;

// transfer files to this IP address
const TRANSFER_TO_USER = process.env.TRANSFER_TO_USER;
const TRANSFER_TO_IP = process.env.TRANSFER_TO_IP;
export const TRANSFER_TO = `${TRANSFER_TO_USER}@${TRANSFER_TO_IP}`;
export const TRANSFER_DIR = "/media/roberts/jellyfin/media/UNSORTED";

// an api to return progress, for my personal use
export const FRONTEND_API = process.env.API_URL;
