// goal DX:
// handbrake.init(video);
// handbrake.sample() -> avgBitrate, estimatedSize
// handbrake.transcode() -> outputVideo

import { spawn } from "bun";
import { join } from "node:path";
import {
  CALL_HANDBRAKE,
  EIGHT_BIT_COLOR_PROFILES,
  HARDWARE_ACCEL_TYPE,
  hwAccel_h265,
  hwAccel_h265_10,
  NO_SUBTITLE_PRESET,
  PRESET_DIR,
  RUN_TYPE,
  software_h265,
  software_h265_10,
  SUBTITLE_PRESET,
  TO_CONTAINER,
} from "../consts";
import { formatSeconds, log, round } from "../utils";
import { GenericFile, MediaFile, type Metadata } from "./media-file";

export type TranscodeSettings = {
  outputVideo: MediaFile;
  hardwareEncoder: string;
  softwareEncoder: string;
  preset: GenericFile;
  presetName: string;
  samplePreset: GenericFile;
  samplePresetName: string;
};

export type RunCommandOptions = {
  outputVideo: MediaFile;
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
    settings: TranscodeSettings
  ) {
    this.video = video;
    this.metadata = metadata;
    this.settings = settings;
  }

  private static async getSettings(
    video: MediaFile,
    metadata: Metadata
  ): Promise<TranscodeSettings> {
    // output
    const outputFileName = `${video.base}_HBPROCESSED${TO_CONTAINER}`;
    const outputVideo = await MediaFile.init(
      join(video.dirPath, outputFileName)
    );

    // encoding settings
    const hardwareEncoder = EIGHT_BIT_COLOR_PROFILES.includes(
      metadata.colorProfile
    )
      ? hwAccel_h265
      : hwAccel_h265_10;
    const softwareEncoder =
      hardwareEncoder === hwAccel_h265_10 ? software_h265_10 : software_h265;

    const presetDirPath = await GenericFile.init(PRESET_DIR);
    const subtitlePreset = await GenericFile.init(
      join(presetDirPath.unixPath, SUBTITLE_PRESET)
    );
    const noSubtitlePreset = await GenericFile.init(
      join(presetDirPath.unixPath, NO_SUBTITLE_PRESET)
    );

    // preset
    // const preset =
    //   video.extension === ".mkv" ? noSubtitlePreset : subtitlePreset;
    const preset = subtitlePreset;
    const samplePreset = noSubtitlePreset;

    const getPresetName = async (preset: GenericFile) => {
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

    const presetName = await getPresetName(preset);
    const samplePresetName = await getPresetName(samplePreset);

    return {
      outputVideo,
      hardwareEncoder,
      softwareEncoder,
      preset,
      presetName,
      samplePreset,
      samplePresetName,
    };
  }

  public static async init(video: MediaFile) {
    const metadata = await video.getDetails();
    if (!metadata) {
      throw new Error(
        `Failed to get video metadata for ${video.base}. Cannot initialize Handbrake.`
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

    const inputPath =
      RUN_TYPE === "unix" ? this.video.unixPath : this.video.winPath;
    const outputPath =
      RUN_TYPE === "unix"
        ? options.outputVideo.unixPath
        : options.outputVideo.winPath;

    const baseArgs = [...CALL_HANDBRAKE, "-i", inputPath, "-o", outputPath];

    if (options.start && options.duration) {
      baseArgs.push(
        "--preset-import-file",
        RUN_TYPE === "unix"
          ? this.settings.samplePreset.unixPath
          : this.settings.samplePreset.winPath,
        "-Z",
        this.settings.samplePresetName,
        "--start-at",
        `seconds:${options.start}`,
        "--stop-at",
        `seconds:${options.duration}`
      );
    } else {
      baseArgs.push(
        "--preset-import-file",
        RUN_TYPE === "unix"
          ? this.settings.preset.unixPath
          : this.settings.preset.winPath,
        "-Z",
        this.settings.presetName
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
        options.outputVideo.name.split(/[\\/]/).pop() ||
        options.outputVideo.name; // Get filename for logging

      try {
        const proc = spawn({
          cmd: finalArgs,
          stdout: "pipe",
          stderr: "pipe",
        });

        // // Capture stdout
        // (async () => {
        //   for await (const chunk of proc.stdout) {
        //     console.log(`${new TextDecoder().decode(chunk)}`);
        //   }
        // })();

        // // Capture stderr
        // (async () => {
        //   for await (const chunk of proc.stderr) {
        //     console.error(`${new TextDecoder().decode(chunk)}`);
        //   }
        // })();

        const exitCode = await proc.exited;

        if (exitCode === 0) {
          await Bun.sleep(2500);

          return;
        } else {
          lastError = new Error(
            `Handbrake (${strat.name}) for ${outputName} failed with exit code ${exitCode}.`
          );
          log(lastError.message, "WARN");
        }
      } catch (error: any) {
        // Catch errors during spawn itself (e.g., command not found)
        lastError = new Error(
          `Failed to spawn Handbrake (${strat.name}) for ${outputName}: ${error.message}`
        );
        log(lastError.message, "WARN");
      }
      await Bun.sleep(2500);
    }
  }

  async transcode(quality: number) {
    const now = performance.now();
    log(`Transcoding ${this.video.name}, q=${quality}...`);

    await this.runCommand({
      outputVideo: this.settings.outputVideo,
      quality: quality,
    });

    log(
      `Transcode completed in ${formatSeconds(
        (performance.now() - now) / 1000
      )}`
    );

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
        join(
          this.video.dirPath,
          `${this.settings.outputVideo.base}_${n}${TO_CONTAINER}`
        )
      );
    };

    log(
      `Running sample with ${options.samples} samples of ${sampleLength} seconds each at q=${options.quality}...`
    );

    const timeTable: { start: number; duration: number; output: MediaFile }[] =
      [];
    const timeFrames = Math.floor(this.metadata.length / options.samples);

    for (let i = 0; i < options.samples; i++) {
      const start = i * timeFrames;

      timeTable.push({
        start: start == 0 ? 1 : start,
        duration: sampleLength,
        output: await getSampleVideo(i),
      });
    }

    let totalBitrate = 0;
    let totalSize = 0;
    let successfulSamples = 0;
    let sample = 0;

    for (const time of timeTable) {
      sample++;
      const now = performance.now();

      await this.runCommand({
        outputVideo: time.output,
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
          `Sample #${sample} completed in ${runtime}. Bitrate: ${stats.bitrate} Mb/s. Size: ${stats.size} MB`
        );
      } else {
        log(
          `Sample #${sample} failed to get valid stats (${runtime}). Excluding from average.`,
          "WARN"
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
      `Handbrake sample completed. Estimated size: ${round(
        (avgBitrate * this.metadata.length) / 8
      )} MB. Average bitrate: ${avgBitrate} Mb/s. Average size: ${avgSize} MB`
    );

    return {
      avgBitrate,
      estimatedSize: round((avgBitrate * this.metadata.length) / 8),
    };
  }
}
