// goal DX:
// handbrake.init(video);
// handbrake.sample() -> avgBitrate, estimatedSize
// handbrake.transcode() -> outputVideo

import { sleep, spawn } from "bun";
import {
  EIGHT_BIT_COLOR_PROFILES,
  HANDBRAKE_PATH,
  HARDWARE_ACCEL_TYPE,
  hwAccel_h265,
  hwAccel_h265_10,
  NO_SUBTITLE_PRESET,
  PRESET_DIR,
  software_h265,
  software_h265_10,
  SUBTITLE_PRESET,
} from "../consts";
import { formatSeconds, log, round } from "../utils";
import { GenericFile, MediaFile, type Metadata } from "./media-file";
import { join } from "node:path";

export type TranscodeSettings = {
  outputVideo: MediaFile;
  hardwareEncoder: string;
  softwareEncoder: string;
  preset: GenericFile;
  presetName: string;
};

export type RunCommandOptions = {
  outputPath: string;
  quality: number;
  start?: number;
  duration?: number;
};

export class Handbrake {
  private video: MediaFile;
  private metadata: Metadata;
  private settings: TranscodeSettings;

  private constructor(
    video: MediaFile,
    metadata: Metadata,
    settings: TranscodeSettings,
  ) {
    this.video = video;
    this.metadata = metadata;
    this.settings = settings;
  }

  private static async getSettings(video: MediaFile, metadata: Metadata) {
    // output
    const outputFileName = `${video.base}_HBPROCESSED.mp4`;
    const outputVideo = await MediaFile.init(
      join(video.dirPath, outputFileName),
    );

    // encoding settings
    const hardwareEncoder = EIGHT_BIT_COLOR_PROFILES.includes(
      metadata.colorProfile,
    )
      ? hwAccel_h265
      : hwAccel_h265_10;
    const softwareEncoder =
      hardwareEncoder === hwAccel_h265_10 ? software_h265_10 : software_h265;

    const presetDirPath = await GenericFile.init(PRESET_DIR);
    const subtitlePreset = await GenericFile.init(
      join(presetDirPath.unixPath, SUBTITLE_PRESET),
    );
    const noSubtitlePreset = await GenericFile.init(
      join(presetDirPath.unixPath, NO_SUBTITLE_PRESET),
    );

    // preset
    const preset =
      video.extension === ".mkv" ? noSubtitlePreset : subtitlePreset;

    const getPresetName = async () => {
      const presetFile = Bun.file(preset.unixPath);
      const isFile = await presetFile.exists();
      if (!isFile) {
        log(`Handbrake preset file not found: ${preset.unixPath}`, "ERROR");
        return;
      }

      const jsonData = JSON.parse(await presetFile.text());
      const presetName = jsonData["PresetList"][0]["PresetName"];
      return presetName;
    };

    const presetName = await getPresetName();

    return {
      outputVideo,
      hardwareEncoder,
      softwareEncoder,
      preset,
      presetName,
    };
  }

  public static async init(video: MediaFile) {
    const metadata = await video.getDetails();
    if (!metadata) {
      throw new Error(
        `Failed to get video metadata for ${video.base}. Cannot initialize Handbrake.`,
      );
    }

    const settings: TranscodeSettings = await this.getSettings(video, metadata);

    log(`Handbrake initialized for ${video.base}`, "VERBOSE");
    return new Handbrake(video, metadata, settings);
  }

  private async runCommand(options: RunCommandOptions) {
    const strategies = [
      {
        name: "HW Accel",
        encoder: this.settings.hardwareEncoder,
        flags: HARDWARE_ACCEL_TYPE
          ? `--enable-hw-decoding ${HARDWARE_ACCEL_TYPE}`
          : "",
        enabled: HARDWARE_ACCEL_TYPE != "",
      },
      {
        name: "Semi-Software Fallback",
        encoder: this.settings.hardwareEncoder,
        flags: "",
        enabled: true,
      },
      {
        name: "Full Software Fallback",
        encoder: this.settings.softwareEncoder,
        flags: "",
        enabled: true,
      },
    ];

    const baseArgs = [
      // `cmd.exe /c ${HANDBRAKE_PATH}`,
      "HandBrakeCLI",
      "--preset-import-file",
      this.settings.preset.winPath,
      "-Z",
      this.settings.presetName,
      "-i",
      this.video.winPath,
      "-o",
      options.outputPath,
    ];

    if (options.start && options.duration) {
      baseArgs.push(
        "--start-at",
        `seconds:${options.start}`,
        "--stop-at",
        `seconds:${options.duration}`,
      );
    }

    let lastError: Error | null = null; // Keep track of the last error
    for (const strat of strategies) {
      if (!strat.enabled) continue;

      const finalArgs = [
        ...baseArgs,
        "-e",
        strat.encoder,
        "-q",
        options.quality.toString(),
      ];

      if (strat.flags) {
        finalArgs.push(...strat.flags.split(" ").filter(Boolean));
      }

      const outputName =
        options.outputPath.split(/[\\/]/).pop() || options.outputPath; // Get filename for logging

      try {
        const proc = spawn({
          cmd: finalArgs,
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;

        if (exitCode === 0) {
          log(`Handbrake (${strat.name}) for ${outputName} succeeded!`);
          return;
        } else {
          lastError = new Error(
            `Handbrake (${strat.name}) for ${outputName} failed with exit code ${exitCode}.`,
          );
          log(lastError.message, "WARN");
        }
      } catch (error: any) {
        // Catch errors during spawn itself (e.g., command not found)
        lastError = new Error(
          `Failed to spawn Handbrake (${strat.name}) for ${outputName}: ${error.message}`,
        );
        log(lastError.message, "WARN");
      }
      await sleep(5000);
    }
  }

  async transcode(quality: number) {
    const now = performance.now();
    log(`Transcoding ${this.video.name}, q=${quality}...`);

    await this.runCommand({
      outputPath: this.settings.outputVideo.winPath,
      quality: quality,
    });

    log(
      `Transcode completed in ${formatSeconds((performance.now() - now) / 1000)}`,
    );

    await this.video.delete();
    await this.settings.outputVideo.rename(this.video.name);

    return this.settings.outputVideo;
  }

  // returns the average bitrate and the estimated size of the transcode from 3 samples
  async sample(options: {
    quality: number;
    samples: number;
    sampleLength: number;
  }) {
    if (
      options.samples <= 0 ||
      options.sampleLength <= 0 ||
      options.quality <= 0 ||
      options.quality > 51
    ) {
      throw new Error("Invalid sample options");
    }

    let sampleLength = options.sampleLength;
    if (options.sampleLength * options.samples > this.metadata.length) {
      sampleLength = Math.floor(this.metadata.length / options.samples);
    }

    const getSampleVideo = async (n: number) => {
      return await MediaFile.init(
        join(this.video.dirPath, `${this.settings.outputVideo.base}_${n}.mp4`),
      );
    };

    log(
      `Running sample with ${options.samples} samples of ${options.sampleLength} seconds each at q=${options.quality}...`,
    );

    const timeTable: { start: number; duration: number; output: MediaFile }[] =
      [];
    const timeFrames = Math.floor(this.metadata.length / options.samples);

    for (let i = 0; i < options.samples; i++) {
      const start = i * timeFrames;

      timeTable.push({
        start: start == 0 ? 1 : start,
        duration: options.sampleLength,
        output: await getSampleVideo(i),
      });
    }

    const videoChunkCount = Math.ceil(
      this.metadata.length / options.sampleLength,
    );

    let totalBitrate = 0;
    let totalSize = 0;
    let successfulSamples = 0;
    let sample = 0;

    for (const time of timeTable) {
      sample++;
      const now = performance.now();

      await this.runCommand({
        outputPath: time.output.winPath,
        start: time.start,
        duration: time.duration,
        quality: options.quality,
      });

      const stats = await time.output.getDetails();

      const runtime = formatSeconds((performance.now() - now) / 1000);

      if (stats && stats.bitrate > 0) {
        totalBitrate += stats.bitrate;
        totalSize += stats.size;
        successfulSamples++;
        log(
          `Sample #${sample} completed in ${runtime}. Bitrate: ${stats.bitrate} Mb/s. Size: ${stats.size} MB`,
        );
      } else {
        log(
          `Sample #${sample} failed to get valid stats (${runtime}). Excluding from average.`,
          "WARN",
        );
      }
      await time.output.delete();
    }

    if (successfulSamples === 0) {
      throw new Error("All samples failed to produce valid statistics.");
    }

    const avgBitrate = round(totalBitrate / successfulSamples);
    const avgSize = round(totalSize / successfulSamples);

    log(
      `Handbrake sample completed. Estimated size: ${round((avgBitrate * this.metadata.length) / 8)} MB. Average bitrate: ${avgBitrate} Mb/s. Average size: ${avgSize} MB`,
    );

    return {
      avgBitrate,
      estimatedSize: round((avgBitrate * this.metadata.length) / 8),
    };
  }
}
