import { TRANSFER_TO } from "./consts";
import { log, type JSONMetadata } from "./utils";
import { $ } from "bun";

export const transferFiles = async (
  absoluteDestinationDir: string,
  jsonData: JSONMetadata,
) => {
  log(`Transferring files to ${TRANSFER_TO}...`, "LOG");

  if (jsonData.torrent_type === "new") {
    await $`scp -r "${absoluteDestinationDir}" ${TRANSFER_TO}:"${jsonData.media_output_directory}"`;
  } else {
    await $`scp -r "${absoluteDestinationDir}"/* ${TRANSFER_TO}:"${jsonData.media_output_directory}"`;
  }
};
