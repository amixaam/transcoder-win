import { $ } from "bun";
import { DEFAULT_TRANSFER_DIR, TRANSFER_TO } from "./consts";
import { log, type JSONMetadata } from "./utils";

export const transferFiles = async (
  absoluteDestinationDir: string,
  jsonData: JSONMetadata
) => {
  if (
    jsonData.media_output_directory == "" ||
    jsonData.media_output_directory == undefined
  ) {
    log(
      `No media_output_directory specified in JSON file. Using default.`,
      "ERROR"
    );
    jsonData.media_output_directory = DEFAULT_TRANSFER_DIR;
  }

  log(`Transferring files to ${TRANSFER_TO}...`);
  if (jsonData.torrent_type === "new") {
    await $`scp -r "${absoluteDestinationDir}" ${TRANSFER_TO}:"${jsonData.media_output_directory}"`;
  } else {
    await $`scp -r "${absoluteDestinationDir}"/* ${TRANSFER_TO}:"${jsonData.media_output_directory}"`;
  }
  log(
    `Transfer to ${TRANSFER_TO}:${jsonData.media_output_directory} complete!`
  );
};
